from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import numpy as np
    import pandas as pd
    from scipy import stats
except ImportError as error:  # pragma: no cover - exercised only without deps.
    raise SystemExit(
        "pandas and scipy are required. Install backend dependencies with: "
        "python -m pip install -r backend/requirements.txt"
    ) from error


SUPPORTED_EXTENSIONS = {".csv", ".xlsx", ".xls", ".json", ".jsonl", ".parquet"}
DEFAULT_POLICY_PATH = Path("config") / "data_treatment_policy.json"


@dataclass
class TreatmentResult:
    input_path: Path
    output_path: Path
    report_path: Path
    rows_before: int
    rows_after: int
    columns_before: int
    columns_after: int
    actions: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def snake_case(value: str) -> str:
    normalized = value.encode("ascii", "ignore").decode("ascii").lower()
    normalized = re.sub(r"[^a-z0-9]+", "_", normalized).strip("_")
    return normalized or "column"


def unique_column_names(columns: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    unique = []
    for column in columns:
        base = snake_case(column)
        count = seen.get(base, 0)
        seen[base] = count + 1
        unique.append(base if count == 0 else f"{base}_{count + 1}")
    return unique


def load_dataset(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {suffix}. Supported: {sorted(SUPPORTED_EXTENSIONS)}")
    if suffix == ".csv":
        return pd.read_csv(path)
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(path)
    if suffix == ".json":
        return pd.read_json(path)
    if suffix == ".jsonl":
        return pd.read_json(path, lines=True)
    return pd.read_parquet(path)


def write_dataset(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    suffix = path.suffix.lower()
    if suffix == ".csv":
        df.to_csv(path, index=False)
        return
    if suffix in {".xlsx", ".xls"}:
        df.to_excel(path, index=False)
        return
    if suffix == ".json":
        df.to_json(path, orient="records", indent=2, force_ascii=False)
        return
    if suffix == ".jsonl":
        df.to_json(path, orient="records", lines=True, force_ascii=False)
        return
    if suffix == ".parquet":
        df.to_parquet(path, index=False)
        return
    raise ValueError(f"Unsupported output type: {suffix}")


def load_treatment_policy(path: Path = DEFAULT_POLICY_PATH) -> dict[str, Any]:
    if not path.exists():
        return {
            "master_prompt": "prompts/master_data_treatment.md",
            "execution_modes": {
                "automatic": [],
                "assisted_by_prompt": [],
                "advanced_not_automatic_yet": [],
            },
        }
    return json.loads(path.read_text(encoding="utf-8-sig"))


def infer_column_groups(df: pd.DataFrame) -> dict[str, list[str]]:
    numeric = list(df.select_dtypes(include=["number"]).columns)
    boolean = list(df.select_dtypes(include=["bool"]).columns)
    datetime = list(df.select_dtypes(include=["datetime", "datetimetz"]).columns)
    categorical = [
        column
        for column in df.columns
        if column not in set(numeric + boolean + datetime)
    ]
    return {
        "numeric": numeric,
        "categorical": categorical,
        "boolean": boolean,
        "datetime": datetime,
    }


def numeric_profile(series: pd.Series) -> dict[str, Any]:
    clean = pd.to_numeric(series, errors="coerce").dropna()
    if clean.empty:
        return {}
    mode = clean.mode(dropna=True)
    q1 = clean.quantile(0.25)
    q3 = clean.quantile(0.75)
    iqr = q3 - q1
    return {
        "count": int(clean.shape[0]),
        "mean": float(clean.mean()),
        "median": float(clean.median()),
        "mode": float(mode.iloc[0]) if not mode.empty else None,
        "min": float(clean.min()),
        "max": float(clean.max()),
        "range": float(clean.max() - clean.min()),
        "q1": float(q1),
        "q3": float(q3),
        "variance": float(clean.var()) if clean.shape[0] > 1 else 0.0,
        "std": float(clean.std()) if clean.shape[0] > 1 else 0.0,
        "iqr": float(iqr),
        "skew": float(clean.skew()) if clean.shape[0] > 2 else 0.0,
        "kurtosis": float(clean.kurtosis()) if clean.shape[0] > 3 else 0.0,
    }


def iqr_bounds(series: pd.Series) -> tuple[float, float] | None:
    clean = pd.to_numeric(series, errors="coerce").dropna()
    if clean.empty:
        return None
    q1 = clean.quantile(0.25)
    q3 = clean.quantile(0.75)
    iqr = q3 - q1
    if iqr == 0 or math.isnan(float(iqr)):
        return None
    return float(q1 - 1.5 * iqr), float(q3 + 1.5 * iqr)


def confidence_interval_mean(series: pd.Series, confidence: float = 0.95) -> dict[str, float] | None:
    clean = pd.to_numeric(series, errors="coerce").dropna()
    if clean.shape[0] < 2:
        return None
    mean = float(clean.mean())
    sem = float(stats.sem(clean))
    if sem == 0 or math.isnan(sem):
        return {"confidence": confidence, "mean": mean, "lower": mean, "upper": mean}
    margin = float(stats.t.ppf((1 + confidence) / 2, clean.shape[0] - 1) * sem)
    return {"confidence": confidence, "mean": mean, "lower": mean - margin, "upper": mean + margin}


def bootstrap_mean_interval(series: pd.Series, confidence: float = 0.95, samples: int = 300) -> dict[str, float] | None:
    clean = pd.to_numeric(series, errors="coerce").dropna().to_numpy(dtype=float)
    if clean.shape[0] < 2:
        return None
    rng = np.random.default_rng(42)
    means = np.array([rng.choice(clean, size=clean.shape[0], replace=True).mean() for _ in range(samples)])
    alpha = (1 - confidence) / 2
    return {
        "confidence": confidence,
        "samples": float(samples),
        "lower": float(np.quantile(means, alpha)),
        "upper": float(np.quantile(means, 1 - alpha)),
    }


def normality_test(series: pd.Series) -> dict[str, float | str] | None:
    clean = pd.to_numeric(series, errors="coerce").dropna()
    if clean.shape[0] < 3:
        return None
    if clean.shape[0] <= 5000:
        statistic, p_value = stats.shapiro(clean)
        return {"test": "shapiro", "statistic": float(statistic), "p_value": float(p_value)}
    statistic, p_value = stats.normaltest(clean)
    return {"test": "dagostino_pearson", "statistic": float(statistic), "p_value": float(p_value)}


def numeric_correlations(df: pd.DataFrame, numeric_columns: list[str]) -> dict[str, dict[str, float]]:
    if len(numeric_columns) < 2:
        return {}
    numeric = df[numeric_columns].apply(pd.to_numeric, errors="coerce")
    pearson = numeric.corr(method="pearson").fillna(0.0)
    spearman = numeric.corr(method="spearman").fillna(0.0)
    result: dict[str, dict[str, float]] = {}
    for left_index, left in enumerate(numeric_columns):
        for right in numeric_columns[left_index + 1:]:
            result[f"{left}__{right}"] = {
                "pearson": float(pearson.loc[left, right]),
                "spearman": float(spearman.loc[left, right]),
            }
    return result


def chi_square_associations(df: pd.DataFrame, categorical_columns: list[str]) -> dict[str, dict[str, float]]:
    if len(categorical_columns) < 2:
        return {}
    result: dict[str, dict[str, float]] = {}
    for left_index, left in enumerate(categorical_columns):
        for right in categorical_columns[left_index + 1:]:
            contingency = pd.crosstab(df[left], df[right])
            if contingency.shape[0] < 2 or contingency.shape[1] < 2:
                continue
            statistic, p_value, dof, _expected = stats.chi2_contingency(contingency)
            result[f"{left}__{right}"] = {
                "chi2": float(statistic),
                "p_value": float(p_value),
                "dof": float(dof),
            }
    return result


def try_parse_dates(df: pd.DataFrame, actions: list[str], threshold: float = 0.8) -> pd.DataFrame:
    for column in list(df.select_dtypes(include=["object", "string"]).columns):
        non_null = df[column].dropna()
        if non_null.empty:
            continue
        date_like_ratio = non_null.astype(str).str.contains(r"\d{1,4}[-/]\d{1,2}[-/]\d{1,4}", regex=True).mean()
        if float(date_like_ratio) < threshold:
            continue
        parsed = pd.to_datetime(non_null, errors="coerce")
        valid_ratio = float(parsed.notna().mean())
        if valid_ratio >= threshold:
            df[column] = pd.to_datetime(df[column], errors="coerce")
            actions.append(f"Coluna `{column}` convertida para data; {valid_ratio:.1%} dos valores nao nulos foram parseados.")
    return df


def treat_dataset(
    input_path: Path,
    output_path: Path | None = None,
    report_path: Path | None = None,
    rare_category_threshold: float = 0.01,
    drop_missing_column_threshold: float = 0.8,
    winsorize_outliers: bool = False,
) -> TreatmentResult:
    input_path = input_path.resolve()
    if not input_path.exists():
        raise FileNotFoundError(input_path)

    output_path = output_path or input_path.parent.parent / "processed" / f"{input_path.stem}_treated.csv"
    report_path = report_path or Path("output") / "data_treatment" / f"{input_path.stem}_report.md"

    raw = load_dataset(input_path)
    policy = load_treatment_policy()
    rows_before, columns_before = raw.shape
    actions: list[str] = []
    warnings: list[str] = []

    df = raw.copy()
    original_columns = list(df.columns)
    df.columns = unique_column_names([str(column) for column in df.columns])
    if list(df.columns) != original_columns:
        actions.append("Nomes de colunas padronizados para snake_case e nomes duplicados tornados unicos.")

    object_columns = list(df.select_dtypes(include=["object", "string"]).columns)
    for column in object_columns:
        df[column] = df[column].map(lambda value: value.strip() if isinstance(value, str) else value)
        df[column] = df[column].replace({"": pd.NA, "nan": pd.NA, "None": pd.NA, "null": pd.NA, "NULL": pd.NA})
    if object_columns:
        actions.append("Campos de texto foram aparados e strings vazias/nulas foram tratadas como ausentes.")

    duplicate_count = int(df.duplicated().sum())
    if duplicate_count:
        df = df.drop_duplicates().reset_index(drop=True)
        actions.append(f"{duplicate_count} linha(s) duplicada(s) exata(s) removida(s).")

    df = try_parse_dates(df, actions)

    missing_ratio = df.isna().mean()
    high_missing_columns = [
        column for column, ratio in missing_ratio.items()
        if ratio >= drop_missing_column_threshold
    ]
    if high_missing_columns:
        df = df.drop(columns=high_missing_columns)
        actions.append(
            "Colunas removidas por excesso de ausentes "
            f"(>= {drop_missing_column_threshold:.0%}): {', '.join(high_missing_columns)}."
        )

    constant_columns = [
        column for column in df.columns
        if df[column].nunique(dropna=True) <= 1
    ]
    if constant_columns:
        df = df.drop(columns=constant_columns)
        actions.append(f"Colunas constantes removidas: {', '.join(constant_columns)}.")

    groups = infer_column_groups(df)
    outlier_summary: dict[str, dict[str, Any]] = {}
    missing_summary = df.isna().sum().to_dict()
    categorical_frequency: dict[str, dict[str, Any]] = {}
    numeric_stats = {column: numeric_profile(df[column]) for column in groups["numeric"]}
    advanced_statistics = {
        "normality": {
            column: result
            for column in groups["numeric"]
            if (result := normality_test(df[column])) is not None
        },
        "confidence_intervals": {
            column: result
            for column in groups["numeric"]
            if (result := confidence_interval_mean(df[column])) is not None
        },
        "bootstrap_mean_intervals": {
            column: result
            for column in groups["numeric"]
            if (result := bootstrap_mean_interval(df[column])) is not None
        },
        "correlations": numeric_correlations(df, groups["numeric"]),
        "chi_square_associations": chi_square_associations(df, groups["categorical"]),
    }

    for column in groups["numeric"]:
        if df[column].isna().any():
            df[f"{column}_was_missing"] = df[column].isna()
            profile = numeric_stats.get(column, {})
            skew = abs(float(profile.get("skew", 0.0)))
            bounds = iqr_bounds(df[column])
            has_outliers = False
            if bounds:
                lower, upper = bounds
                has_outliers = bool(((df[column] < lower) | (df[column] > upper)).any())
            if skew > 1 or has_outliers:
                value = df[column].median()
                method = "mediana"
            else:
                value = df[column].mean()
                method = "media"
            df[column] = df[column].fillna(value)
            actions.append(f"Ausentes em `{column}` imputados por {method}; flag `{column}_was_missing` criada.")

        bounds = iqr_bounds(df[column])
        if bounds:
            lower, upper = bounds
            flag_column = f"{column}_is_outlier_iqr"
            flags = (df[column] < lower) | (df[column] > upper)
            outlier_count = int(flags.sum())
            outlier_summary[column] = {
                "method": "IQR",
                "lower": lower,
                "upper": upper,
                "count": outlier_count,
                "ratio": float(flags.mean()),
                "action": "winsorized" if winsorize_outliers and outlier_count else "flagged",
            }
            if outlier_count:
                df[flag_column] = flags
                actions.append(f"Outliers de `{column}` identificados por IQR; flag `{flag_column}` criada.")
                if winsorize_outliers:
                    df[column] = df[column].clip(lower=lower, upper=upper)
                    actions.append(f"`{column}` winsorizada nos limites IQR [{lower:.4g}, {upper:.4g}].")

    for column in infer_column_groups(df)["categorical"]:
        if df[column].isna().any():
            mode = df[column].mode(dropna=True)
            if mode.empty:
                df[column] = df[column].fillna("unknown")
                fill_value = "unknown"
            else:
                fill_value = mode.iloc[0]
                df[column] = df[column].fillna(fill_value)
            df[f"{column}_was_missing"] = raw.get(column, df[column]).isna() if column in raw else False
            actions.append(f"Ausentes em `{column}` imputados por moda/unknown; flag `{column}_was_missing` criada.")

        normalized = df[column].map(lambda value: value.lower().strip() if isinstance(value, str) else value)
        if not normalized.equals(df[column]):
            df[column] = normalized
            actions.append(f"Categorias de `{column}` padronizadas em minusculas e sem espacos nas bordas.")

        frequencies = df[column].value_counts(dropna=False, normalize=True)
        rare_values = set(frequencies[frequencies < rare_category_threshold].index)
        categorical_frequency[column] = {
            "top_values": df[column].value_counts(dropna=False).head(10).to_dict(),
            "rare_values_count": len(rare_values),
        }
        if rare_values:
            df[column] = df[column].map(lambda value: "other_rare" if value in rare_values else value)
            actions.append(
                f"{len(rare_values)} categoria(s) rara(s) em `{column}` agrupada(s) como `other_rare` "
                f"(< {rare_category_threshold:.1%})."
            )

    quasi_constant_columns = []
    for column in df.columns:
        frequencies = df[column].value_counts(dropna=False, normalize=True)
        if not frequencies.empty and float(frequencies.iloc[0]) >= 0.99:
            quasi_constant_columns.append(column)
    if quasi_constant_columns:
        warnings.append(
            "Colunas quase constantes mantidas para decisao do usuario/modelagem: "
            + ", ".join(quasi_constant_columns)
        )

    write_dataset(df, output_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report = build_report(
        input_path=input_path,
        output_path=output_path,
        df_before=raw,
        df_after=df,
        numeric_stats=numeric_stats,
        missing_summary=missing_summary,
        outlier_summary=outlier_summary,
        categorical_frequency=categorical_frequency,
        advanced_statistics=advanced_statistics,
        actions=actions,
        warnings=warnings,
        winsorize_outliers=winsorize_outliers,
        policy=policy,
    )
    report_path.write_text(report, encoding="utf-8")

    return TreatmentResult(
        input_path=input_path,
        output_path=output_path,
        report_path=report_path,
        rows_before=rows_before,
        rows_after=int(df.shape[0]),
        columns_before=columns_before,
        columns_after=int(df.shape[1]),
        actions=actions,
        warnings=warnings,
    )


def build_report(
    input_path: Path,
    output_path: Path,
    df_before: pd.DataFrame,
    df_after: pd.DataFrame,
    numeric_stats: dict[str, dict[str, Any]],
    missing_summary: dict[str, int],
    outlier_summary: dict[str, dict[str, Any]],
    categorical_frequency: dict[str, dict[str, Any]],
    advanced_statistics: dict[str, Any],
    actions: list[str],
    warnings: list[str],
    winsorize_outliers: bool,
    policy: dict[str, Any],
) -> str:
    groups_before = infer_column_groups(df_before)
    groups_after = infer_column_groups(df_after)
    lines = [
        "# Relatorio de Tratamento Estatistico de Dados",
        "",
        "## 0. Alinhamento com prompt mestre",
        "",
        f"- Prompt mestre: `{policy.get('master_prompt', 'prompts/master_data_treatment.md')}`",
        f"- Politica: `{DEFAULT_POLICY_PATH.as_posix()}`",
        "- Este relatorio separa etapas executadas automaticamente, etapas assistidas por prompt e checagens avancadas pendentes.",
        "",
        "## 1. Visao geral da base",
        "",
        f"- Arquivo de entrada: `{input_path}`",
        f"- Dataset tratado: `{output_path}`",
        f"- Linhas antes/depois: {df_before.shape[0]} / {df_after.shape[0]}",
        f"- Colunas antes/depois: {df_before.shape[1]} / {df_after.shape[1]}",
        f"- Variaveis numericas: {', '.join(groups_after['numeric']) or 'nenhuma'}",
        f"- Variaveis categoricas/texto: {', '.join(groups_after['categorical']) or 'nenhuma'}",
        f"- Variaveis booleanas: {', '.join(groups_after['boolean']) or 'nenhuma'}",
        f"- Variaveis de data: {', '.join(groups_after['datetime']) or 'nenhuma'}",
        "",
        "## 2. Problemas encontrados",
        "",
    ]

    missing_items = [f"- `{column}`: {count} ausente(s)" for column, count in missing_summary.items() if count]
    lines.extend(missing_items or ["- Nenhum valor ausente detectado antes do tratamento."])
    lines.append("")

    if outlier_summary:
        lines.append("### Outliers")
        lines.append("")
        for column, summary in outlier_summary.items():
            lines.append(
                f"- `{column}`: {summary['count']} outlier(s) por IQR "
                f"({summary['ratio']:.1%}); acao: {summary['action']}."
            )
        lines.append("")

    if categorical_frequency:
        lines.append("### Categorias")
        lines.append("")
        for column, summary in categorical_frequency.items():
            top_values = json.dumps(summary["top_values"], ensure_ascii=False, default=str)
            lines.append(f"- `{column}`: top categorias {top_values}; raras: {summary['rare_values_count']}.")
        lines.append("")

    lines.extend([
        "## 3. Tratamento estatistico realizado",
        "",
    ])
    lines.extend([f"- {action}" for action in actions] or ["- Nenhum tratamento aplicado."])
    lines.append("")

    lines.extend([
        "## 4. Justificativas tecnicas",
        "",
        "- Remocao de duplicatas exatas reduz contagem artificial sem inferir regra de negocio.",
        "- Colunas com excesso de ausentes sao removidas para reduzir ruido e risco de vies por imputacao massiva.",
        "- Colunas constantes sao removidas porque nao carregam variacao estatistica para modelagem.",
        "- Imputacao numerica usa mediana quando ha assimetria/outliers, pois e mais robusta que media.",
        "- Imputacao numerica usa media apenas quando a distribuicao parece menos assimetrica e sem outliers relevantes.",
        "- Categorias raras sao agrupadas para reduzir esparsidade e instabilidade em modelos futuros.",
        "- Outliers sao sinalizados por padrao, nao removidos automaticamente, preservando eventos raros plausiveis.",
    ])
    if winsorize_outliers:
        lines.append("- Winsorizacao foi aplicada porque `--winsorize-outliers` foi solicitado explicitamente.")
    lines.append("")

    execution_modes = policy.get("execution_modes", {})
    automatic = execution_modes.get("automatic", [])
    assisted = execution_modes.get("assisted_by_prompt", [])
    advanced = execution_modes.get("advanced_not_automatic_yet", [])
    lines.extend([
        "## Cobertura da politica de tratamento",
        "",
        "### Executado automaticamente",
        "",
    ])
    lines.extend([f"- `{item}`" for item in automatic] or ["- Politica automatica nao declarada."])
    lines.extend([
        "",
        "### Assistido pelo prompt mestre",
        "",
    ])
    lines.extend([f"- `{item}`" for item in assisted] or ["- Etapas assistidas nao declaradas."])
    lines.extend([
        "",
        "### Avancado / pendente de implementacao deterministica",
        "",
    ])
    lines.extend([f"- `{item}`" for item in advanced] or ["- Checagens avancadas nao declaradas."])
    lines.append("")

    if numeric_stats:
        lines.append("## Estatisticas numericas iniciais")
        lines.append("")
        for column, stats in numeric_stats.items():
            if not stats:
                continue
            lines.append(f"### `{column}`")
            lines.append("")
            for key, value in stats.items():
                lines.append(f"- {key}: {value}")
            lines.append("")

    lines.append("## Estatisticas avancadas")
    lines.append("")
    if any(advanced_statistics.values()):
        normality = advanced_statistics.get("normality", {})
        if normality:
            lines.append("### Normalidade")
            lines.append("")
            for column, result in normality.items():
                lines.append(
                    f"- `{column}`: {result['test']} statistic={result['statistic']:.4g}, "
                    f"p_value={result['p_value']:.4g}."
                )
            lines.append("")

        intervals = advanced_statistics.get("confidence_intervals", {})
        if intervals:
            lines.append("### Intervalos de confianca da media")
            lines.append("")
            for column, result in intervals.items():
                lines.append(
                    f"- `{column}`: media={result['mean']:.4g}, "
                    f"IC{int(result['confidence'] * 100)}%=[{result['lower']:.4g}, {result['upper']:.4g}]."
                )
            lines.append("")

        bootstrap_intervals = advanced_statistics.get("bootstrap_mean_intervals", {})
        if bootstrap_intervals:
            lines.append("### Bootstrap da media")
            lines.append("")
            for column, result in bootstrap_intervals.items():
                lines.append(
                    f"- `{column}`: IC{int(result['confidence'] * 100)}% bootstrap="
                    f"[{result['lower']:.4g}, {result['upper']:.4g}] com {int(result['samples'])} amostras."
                )
            lines.append("")

        correlations = advanced_statistics.get("correlations", {})
        if correlations:
            lines.append("### Correlacoes numericas")
            lines.append("")
            for pair, result in correlations.items():
                lines.append(
                    f"- `{pair}`: pearson={result['pearson']:.4g}, spearman={result['spearman']:.4g}."
                )
            lines.append("")

        associations = advanced_statistics.get("chi_square_associations", {})
        if associations:
            lines.append("### Associacoes categoricas")
            lines.append("")
            for pair, result in associations.items():
                lines.append(
                    f"- `{pair}`: chi2={result['chi2']:.4g}, p_value={result['p_value']:.4g}, "
                    f"dof={int(result['dof'])}."
                )
            lines.append("")
    else:
        lines.append("- Dataset insuficiente para testes avancados confiaveis.")
        lines.append("")

    lines.extend([
        "## 5. Dataset final tratado",
        "",
        f"- Arquivo: `{output_path}`",
        "- Mudancas rastreadas por flags `_was_missing` e `_is_outlier_iqr` quando aplicavel.",
        "",
        "## 6. Recomendacoes para analise/modelagem",
        "",
        "- Revisar semanticamente outliers sinalizados antes de remove-los.",
        "- Confirmar com o dominio se categorias agrupadas como `other_rare` devem permanecer agrupadas.",
        "- Definir variavel alvo e atualizar `ml_systems/data_contract.yaml` antes do treino.",
        "- Rodar avaliacoes ML/IA depois de qualquer mudanca no tratamento.",
    ])

    if warnings:
        lines.extend(["", "## Alertas", ""])
        lines.extend([f"- {warning}" for warning in warnings])

    lines.extend([
        "",
        "## Prontidao",
        "",
        "Os dados estao tecnicamente tratados, mas a liberacao para modelagem depende da revisao do objetivo de negocio, "
        "variavel alvo, criterios de aceite e decisao de dominio sobre outliers e categorias raras.",
    ])
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Tratamento estatistico de datasets para projetos Synapse.")
    parser.add_argument("--input", required=True, type=Path, help="Arquivo em data/raw ou caminho equivalente.")
    parser.add_argument("--output", type=Path, default=None, help="Arquivo tratado. Padrao: data/processed/<nome>_treated.csv.")
    parser.add_argument("--report", type=Path, default=None, help="Relatorio Markdown. Padrao: output/data_treatment/<nome>_report.md.")
    parser.add_argument("--rare-category-threshold", type=float, default=0.01, help="Frequencia minima para manter categoria.")
    parser.add_argument("--drop-missing-column-threshold", type=float, default=0.8, help="Percentual de ausentes para remover coluna.")
    parser.add_argument("--winsorize-outliers", action="store_true", help="Aplica winsorizacao IQR em vez de apenas flagar outliers.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = treat_dataset(
        input_path=args.input,
        output_path=args.output,
        report_path=args.report,
        rare_category_threshold=args.rare_category_threshold,
        drop_missing_column_threshold=args.drop_missing_column_threshold,
        winsorize_outliers=args.winsorize_outliers,
    )
    print(f"Dataset tratado: {result.output_path}")
    print(f"Relatorio: {result.report_path}")
    print(f"Linhas: {result.rows_before} -> {result.rows_after}")
    print(f"Colunas: {result.columns_before} -> {result.columns_after}")


if __name__ == "__main__":
    main()
