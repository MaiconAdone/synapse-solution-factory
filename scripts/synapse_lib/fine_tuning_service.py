"""Model adaptation governance: decide prompt vs RAG vs fine-tuning, and prepare
fine-tuning datasets under config/fine_tuning_policy.json.

No training or provider call happens here. The service produces a validated,
deduplicated, leakage-free train/validation split plus a readiness report that
a human approves before any weights change (automatic_weight_updates=false).
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from scripts.synapse_lib.text_utils import normalize_text

VALID_ROLES = {"system", "user", "assistant"}
PII_PATTERNS = {
    "email": re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),
    "cpf": re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b"),
    "card_number": re.compile(r"\b(?:\d[ -]?){13,16}\b"),
    "phone_br": re.compile(r"\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b"),
}
SECRET_PATTERNS = {
    "api_key": re.compile(r"\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b"),
    "aws_access_key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "private_key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "password_assignment": re.compile(r"(?i)\b(password|senha|secret|token)\s*[:=]\s*\S+"),
}
ADAPTATION_SIGNALS = {
    "knowledge": ["documentos", "documents", "base de conhecimento", "knowledge", "politicas", "manuais", "faq", "citacoes", "citations", "atualizado", "fontes"],
    "behavior": ["formato", "format", "tom", "tone", "estilo", "style", "json", "estrutura", "consistencia", "consistency", "classificar", "classify", "extrair", "extract"],
    "efficiency": ["latencia", "latency", "custo", "cost", "volume", "modelo menor", "smaller model", "distill", "destilacao"],
    "explicit": ["fine-tuning", "fine tuning", "finetuning", "ajuste fino", "lora", "qlora", "sft", "dpo"],
}


class FineTuningError(ValueError):
    pass


def load_policy(root: Path | None = None) -> dict[str, Any]:
    base = root or Path(__file__).resolve().parents[2]
    path = base / "config" / "fine_tuning_policy.json"
    if not path.exists():
        path = Path(__file__).resolve().parents[2] / "config" / "fine_tuning_policy.json"
    return json.loads(path.read_text(encoding="utf-8-sig"))


class AdaptationAdvisor:
    """Maps business text + measured evidence to a stage of the adaptation ladder."""

    def __init__(self, policy: dict[str, Any] | None = None) -> None:
        self.policy = policy or load_policy()

    def recommend(
        self,
        text: str,
        universe: str,
        baseline_measured: bool = False,
        baseline_meets_target: bool | None = None,
        approved_examples: int = 0,
    ) -> dict[str, Any]:
        if universe not in self.policy["applies_to_universes"]:
            return {
                "active": False,
                "recommended_stage": "not_applicable",
                "reason": self.policy["not_applicable_reason_for_ml"],
            }
        normalized = normalize_text(text)
        signals = {
            name: [term for term in terms if normalize_text(term) in normalized]
            for name, terms in ADAPTATION_SIGNALS.items()
        }
        blockers = []
        if not baseline_measured:
            blockers.append("no_measured_baseline")
        if approved_examples < self.policy["dataset"]["min_examples_pilot"]:
            blockers.append("dataset_below_minimum")

        wants_tuning = bool(signals["behavior"] or signals["efficiency"] or signals["explicit"])
        if baseline_meets_target:
            stage = "rag" if signals["knowledge"] else "prompt_engineering"
            reason = "Baseline already meets the target; weight changes add cost without evidence of gain."
        elif wants_tuning and not blockers:
            stage = "fine_tuning"
            reason = "Behavior/efficiency gap with measured baseline and enough approved examples."
        elif signals["knowledge"]:
            stage = "rag"
            reason = "The gap is knowledge; retrieval keeps facts fresh, cited and permission-aware."
        else:
            stage = "prompt_engineering"
            reason = "Start with prompt contracts and few-shot examples, then measure."
        return {
            "active": True,
            "recommended_stage": stage,
            "fine_tuning_candidate": wants_tuning,
            "fine_tuning_blockers": blockers if wants_tuning else [],
            "signals": {name: found for name, found in signals.items() if found},
            "reason": reason,
            "ladder": [step["stage"] for step in self.policy["adaptation_ladder"]],
            "release_gates": self.policy["release_gates"],
        }


class FineTuningDatasetBuilder:
    def __init__(self, root: Path | None = None, policy: dict[str, Any] | None = None) -> None:
        self.root = (root or Path(__file__).resolve().parents[2]).resolve()
        self.policy = policy or load_policy(self.root)

    def prepare(self, input_path: str, output_dir: str = "artifacts/fine_tuning", tier: str = "pilot") -> dict[str, Any]:
        source = self._inside_root(input_path)
        target = self._inside_root(output_dir)
        if not source.exists():
            raise FineTuningError(f"dataset not found: {input_path}")
        dataset_policy = self.policy["dataset"]
        rows, rejected = self._load(source)
        invalid_json_rows = len(rejected)

        accepted: list[dict[str, Any]] = []
        seen: set[str] = set()
        duplicates = 0
        privacy_findings: list[dict[str, Any]] = []
        for line_number, row in rows:
            problems = self._schema_problems(row)
            score = row.get("human_score")
            if score is None or float(score) < float(dataset_policy["min_human_score"]):
                problems.append("human_score_below_threshold")
            findings = self._privacy_findings(row)
            if findings:
                privacy_findings.append({"line": line_number, "findings": findings})
                problems.append("pii_or_secret_detected")
            if self._estimated_tokens(row) > int(dataset_policy["max_estimated_tokens_per_example"]):
                problems.append("example_too_long")
            if problems:
                rejected.append({"line": line_number, "reasons": problems})
                continue
            key = self._dedup_key(row)
            if key in seen:
                duplicates += 1
                continue
            seen.add(key)
            accepted.append(row)

        train, validation = self._split(accepted, float(dataset_policy["validation_fraction"]))
        leakage = len({self._prompt_key(row) for row in train} & {self._prompt_key(row) for row in validation})
        minimum = int(dataset_policy["min_examples_production" if tier == "production" else "min_examples_pilot"])
        blockers = []
        if len(accepted) < minimum:
            blockers.append(f"dataset_below_minimum ({len(accepted)} < {minimum})")
        if leakage:
            blockers.append("train_validation_leakage")
        if not validation:
            blockers.append("empty_validation_split")

        target.mkdir(parents=True, exist_ok=True)
        self._write_jsonl(target / "train.jsonl", train)
        self._write_jsonl(target / "validation.jsonl", validation)
        dataset_hash = hashlib.sha256(
            "\n".join(sorted(self._dedup_key(row) for row in accepted)).encode("utf-8")
        ).hexdigest()
        report = {
            "schema": "synapse-fine-tuning-readiness.v1",
            "tier": tier,
            "ready_for_human_review": not blockers,
            "blockers": blockers,
            "warnings": ["pii_or_secret_rows_excluded_fix_the_source_pipeline"] if privacy_findings else [],
            "counts": {
                "input_rows": len(rows) + invalid_json_rows,
                "accepted": len(accepted),
                "train": len(train),
                "validation": len(validation),
                "duplicates_removed": duplicates,
                "rejected": len(rejected),
            },
            "rejected": rejected[:50],
            "privacy_findings": privacy_findings[:50],
            "dataset_hash": dataset_hash,
            "estimated_train_tokens": sum(self._estimated_tokens(row) for row in train),
            "next_steps": [
                "fill templates/fine_tuning/model_adaptation_card.md",
                "measure prompt + RAG baseline on the validation split",
                "request human approval before any training run",
            ],
            "automatic_weight_updates": False,
        }
        (target / "readiness_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        return report

    def _load(self, source: Path) -> tuple[list[tuple[int, dict[str, Any]]], list[dict[str, Any]]]:
        rows: list[tuple[int, dict[str, Any]]] = []
        rejected: list[dict[str, Any]] = []
        for line_number, line in enumerate(source.read_text(encoding="utf-8-sig").splitlines(), start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                rejected.append({"line": line_number, "reasons": ["invalid_json"]})
                continue
            if not isinstance(value, dict):
                rejected.append({"line": line_number, "reasons": ["invalid_json"]})
                continue
            rows.append((line_number, value))
        return rows, rejected

    def _schema_problems(self, row: dict[str, Any]) -> list[str]:
        messages = row.get("messages")
        if not isinstance(messages, list) or not messages:
            return ["missing_messages"]
        problems = []
        if any(
            not isinstance(message, dict)
            or message.get("role") not in VALID_ROLES
            or not str(message.get("content", "")).strip()
            for message in messages
        ):
            problems.append("invalid_message")
        roles = [message.get("role") for message in messages if isinstance(message, dict)]
        if "user" not in roles or roles[-1] != "assistant":
            problems.append("must_have_user_and_end_with_assistant")
        return problems

    def _privacy_findings(self, row: dict[str, Any]) -> list[str]:
        text = " ".join(str(message.get("content", "")) for message in row.get("messages", []) if isinstance(message, dict))
        found = [name for name, pattern in PII_PATTERNS.items() if pattern.search(text)]
        found.extend(name for name, pattern in SECRET_PATTERNS.items() if pattern.search(text))
        return found

    def _dedup_key(self, row: dict[str, Any]) -> str:
        joined = "|".join(
            f"{message.get('role')}:{normalize_text(str(message.get('content', '')))}"
            for message in row.get("messages", [])
        )
        return hashlib.sha256(joined.encode("utf-8")).hexdigest()

    def _prompt_key(self, row: dict[str, Any]) -> str:
        prompt = " ".join(
            normalize_text(str(message.get("content", "")))
            for message in row.get("messages", [])
            if message.get("role") != "assistant"
        )
        return hashlib.sha256(prompt.encode("utf-8")).hexdigest()

    def _split(self, rows: list[dict[str, Any]], fraction: float) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        # Hash of the prompt side decides the split, so an example never moves
        # between splits across runs and identical prompts never leak across them.
        train, validation = [], []
        for row in rows:
            bucket = int(self._prompt_key(row)[:8], 16) / 0xFFFFFFFF
            (validation if bucket < fraction else train).append(row)
        return train, validation

    def _estimated_tokens(self, row: dict[str, Any]) -> int:
        characters = sum(len(str(message.get("content", ""))) for message in row.get("messages", []) if isinstance(message, dict))
        return max(1, characters // 4)

    def _write_jsonl(self, path: Path, rows: list[dict[str, Any]]) -> None:
        path.write_text(
            "".join(json.dumps({"messages": row["messages"]}, ensure_ascii=False) + "\n" for row in rows),
            encoding="utf-8",
        )

    def _inside_root(self, relative_path: str) -> Path:
        candidate = (self.root / relative_path).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as error:
            raise FineTuningError("fine-tuning paths must stay inside the project") from error
        return candidate
