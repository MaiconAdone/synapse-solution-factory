import json
import math
from pathlib import Path
from typing import Any

from scripts.synapse_lib.schemas.evals import EvalCaseResult
from scripts.synapse_lib.schemas.models import ModelPredictionRequest
from scripts.synapse_lib.model_service import ModelService
from scripts.synapse_lib.rag_retrieval import (
    HybridRetriever,
    index_files,
    mean_reciprocal_rank,
    ndcg_at_k,
    recall_at_k,
)


class EvalServiceError(ValueError):
    pass


class EvalService:
    def __init__(
        self,
        root: Path | None = None,
        model_service: ModelService | None = None,
    ) -> None:
        self.root = root or Path(__file__).resolve().parents[2]
        self.model_service = model_service or ModelService(root=self.root)

    def run_ml_eval(self, model_id: str | None = None, cases_path: str = "evals/ml_cases.jsonl") -> dict[str, Any]:
        cases = self._load_jsonl(cases_path)
        gates = self._load_quality_gates().get("ml", {})
        results: list[EvalCaseResult] = []
        absolute_errors: list[float] = []

        for case in cases:
            result = self._evaluate_ml_case(case, model_id, gates)
            results.append(result)
            if "absolute_error" in result.metrics:
                absolute_errors.append(result.metrics["absolute_error"])

        metrics = self._aggregate_results(results)
        if absolute_errors:
            metrics["mae"] = float(sum(absolute_errors) / len(absolute_errors))
            metrics["rmse"] = float(math.sqrt(sum(error**2 for error in absolute_errors) / len(absolute_errors)))

        passed = self._passed(results)
        return self._response("ml", passed, metrics, gates, results)

    def run_ai_eval(self, cases_path: str = "evals/prompt_cases.jsonl") -> dict[str, Any]:
        cases = self._load_jsonl(cases_path)
        gates = self._load_quality_gates().get("prompt", {})
        results = [self._evaluate_prompt_case(case) for case in cases]
        metrics = self._aggregate_results(results)
        required_pass_rate = float(gates.get("required_pass_rate", 0))
        passed = self._passed(results) and metrics["pass_rate"] >= required_pass_rate
        return self._response("ai_prompt", passed, metrics, gates, results)

    def run_rag_eval(self, cases_path: str = "evals/rag_cases.jsonl") -> dict[str, Any]:
        cases = self._load_jsonl(cases_path)
        gates = self._load_quality_gates().get("rag", {})
        results = [self._evaluate_rag_case(case, gates) for case in cases]
        metrics = self._aggregate_results(results)
        coverage_scores = [result.metrics["term_coverage"] for result in results if "term_coverage" in result.metrics]
        if coverage_scores:
            metrics["avg_term_coverage"] = float(sum(coverage_scores) / len(coverage_scores))
        passed = self._passed(results)
        return self._response("rag", passed, metrics, gates, results)

    def run_retrieval_eval(self, cases_path: str = "evals/retrieval_cases.jsonl") -> dict[str, Any]:
        """Index the bootstrap corpus with the hybrid retriever and gate recall/MRR/nDCG.

        Unlike run_rag_eval (grounding of golden answers), this measures whether
        retrieval actually ranks the labeled source in the top k.
        """
        cases = self._load_jsonl(cases_path)
        gates = self._load_quality_gates().get("retrieval", {})
        k = int(gates.get("k", 5))
        policy_path = self.root / "config" / "rag_scalability_policy.json"
        if not policy_path.exists():
            raise EvalServiceError("config/rag_scalability_policy.json is required for retrieval evals")
        policy = json.loads(policy_path.read_text(encoding="utf-8-sig"))
        corpus = sorted(
            {
                path.relative_to(self.root).as_posix()
                for pattern in policy["evaluation"]["bootstrap_corpus_globs"]
                for path in self.root.glob(pattern)
                if path.is_file()
            }
        )
        retriever = HybridRetriever(
            rrf_k=int(policy["retrieval"]["rrf_k"]),
            low_confidence_below=float(policy["retrieval"]["rerank_only_when_confidence_below"]),
        )
        index_files(
            retriever,
            self.root,
            corpus,
            int(policy["chunking"]["chunk_size_tokens"]),
            int(policy["chunking"]["chunk_overlap_tokens"]),
        )

        results = []
        for case in cases:
            relevant = {str(source) for source in case.get("relevant_sources", [])}
            ranked_sources = retriever.retrieve(str(case.get("query", "")), k=k * 4).sources()
            metrics = {
                "recall_at_k": recall_at_k(ranked_sources, relevant, k),
                "mrr": mean_reciprocal_rank(ranked_sources, relevant),
                "ndcg_at_k": ndcg_at_k(ranked_sources, relevant, k),
            }
            checks = {
                "case_has_id": bool(case.get("id")),
                "case_has_query": bool(case.get("query")),
                "relevant_sources_in_corpus": bool(relevant) and relevant.issubset(set(corpus)),
                "relevant_source_in_top_k": metrics["recall_at_k"] > 0,
            }
            notes = [] if checks["relevant_source_in_top_k"] else [f"top sources: {ranked_sources[:k]}"]
            results.append(
                EvalCaseResult(
                    id=str(case.get("id", "unknown")),
                    passed=all(checks.values()),
                    checks=checks,
                    metrics=metrics,
                    notes=notes,
                )
            )

        metrics = self._aggregate_results(results)
        for name in ("recall_at_k", "mrr", "ndcg_at_k"):
            values = [result.metrics[name] for result in results]
            metrics[name] = float(sum(values) / len(values)) if values else 0.0
        metrics["corpus_documents"] = float(len(corpus))
        passed = (
            bool(results)
            and all(result.checks["relevant_sources_in_corpus"] for result in results)
            and metrics["recall_at_k"] >= float(gates.get("recall_at_k_min", 0.8))
            and metrics["mrr"] >= float(gates.get("mrr_min", 0.5))
            and metrics["ndcg_at_k"] >= float(gates.get("ndcg_at_k_min", 0.5))
        )
        return self._response("retrieval", passed, metrics, gates, results)

    def _evaluate_rag_case(self, case: dict[str, Any], gates: dict[str, Any]) -> EvalCaseResult:
        # Deterministic, LLM-free proxy for faithfulness: instead of asking a
        # model to judge its own answer, we require every expected claim to be
        # textually grounded in the file the case cites as its source. If a
        # golden answer contains a claim the source doesn't back up, the case
        # is itself an unsupported claim and must fail like any hallucination
        # would under guardrails/policy.yaml's unsupported_claim_policy.
        checks: dict[str, bool] = {}
        metrics: dict[str, float] = {}
        notes: list[str] = []

        checks["case_has_id"] = bool(case.get("id"))
        checks["case_has_query"] = bool(case.get("query"))

        expected_source = str(case.get("expected_source", ""))
        if gates.get("citation_required", True):
            checks["citation_present"] = bool(expected_source)

        source_text = ""
        if expected_source:
            source_path = self._resolve_project_path(expected_source)
            checks["source_exists"] = source_path.exists()
            if source_path.exists():
                source_text = source_path.read_text(encoding="utf-8").lower()
            else:
                notes.append(f"expected_source not found: {expected_source}")
        else:
            checks["source_exists"] = False

        expected_terms = [str(term).lower() for term in case.get("expected_answer_contains", [])]
        if expected_terms:
            matched = [term for term in expected_terms if term in source_text]
            coverage = len(matched) / len(expected_terms)
            metrics["term_coverage"] = coverage

            metric_name = str(case.get("metric", "faithfulness"))
            threshold_key = "recall_at_k_min" if metric_name == "recall_at_k" else "faithfulness_min"
            threshold = float(gates.get(threshold_key, 1.0))
            checks[f"{metric_name}_grounded"] = coverage >= threshold

            if coverage < 1.0:
                missing = [term for term in expected_terms if term not in source_text]
                notes.append(f"Terms not grounded in expected_source: {missing}")

        return EvalCaseResult(
            id=str(case.get("id", "unknown")),
            passed=all(checks.values()) if checks else False,
            checks=checks,
            metrics=metrics,
            notes=notes,
        )

    def _evaluate_ml_case(self, case: dict[str, Any], model_id: str | None, gates: dict[str, Any]) -> EvalCaseResult:
        checks: dict[str, bool] = {}
        notes: list[str] = []
        metrics: dict[str, float] = {}

        checks["case_has_id"] = bool(case.get("id"))
        checks["case_has_task"] = bool(case.get("task"))

        if gates.get("baseline_required"):
            checks["baseline_metric_declared"] = bool(case.get("baseline_metric"))

        if gates.get("model_card_required") or case.get("requires_model_card"):
            checks["model_card_exists"] = (self.root / "ml_systems" / "model_card_template.md").exists()

        if gates.get("data_contract_required"):
            checks["data_contract_exists"] = (self.root / "ml_systems" / "data_contract.yaml").exists()

        if case.get("requires_drift_plan"):
            checks["drift_plan_exists"] = (self.root / "ml_systems" / "monitoring_plan.yaml").exists()

        if model_id and "features" in case and "expected" in case:
            prediction = self.model_service.predict(
                model_id,
                ModelPredictionRequest(features=case["features"]),
            )["prediction"]
            expected = float(case["expected"])
            absolute_error = abs(float(prediction) - expected)
            metrics["prediction"] = float(prediction)
            metrics["expected"] = expected
            metrics["absolute_error"] = absolute_error
            checks["prediction_within_tolerance"] = absolute_error <= float(case.get("tolerance", 0.0))
        elif model_id:
            notes.append("No features/expected fields found; skipped prediction metric.")

        return EvalCaseResult(
            id=str(case.get("id", "unknown")),
            passed=all(checks.values()) if checks else False,
            checks=checks,
            metrics=metrics,
            notes=notes,
        )

    def _evaluate_prompt_case(self, case: dict[str, Any]) -> EvalCaseResult:
        prompt_id = str(case.get("prompt_id", ""))
        prompt_text = self._load_prompt(prompt_id)
        expected = [str(value).lower() for value in case.get("expected_contains", [])]
        evaluation_text = " ".join([prompt_text, str(case.get("input", ""))]).lower()
        checks = {
            "case_has_id": bool(case.get("id")),
            "prompt_exists": bool(prompt_text),
            "expected_terms_present": all(term in evaluation_text for term in expected),
            "prompt_injection_check": self._passes_prompt_injection_check(str(case.get("input", ""))),
        }
        notes = []
        if not checks["expected_terms_present"]:
            missing = [term for term in expected if term not in evaluation_text]
            notes.append(f"Missing expected terms: {missing}")

        return EvalCaseResult(
            id=str(case.get("id", "unknown")),
            passed=all(checks.values()),
            checks=checks,
            notes=notes,
        )

    def _load_jsonl(self, relative_path: str) -> list[dict[str, Any]]:
        path = self._resolve_project_path(relative_path)
        if not path.exists():
            raise EvalServiceError(f"Eval cases not found: {relative_path}")
        try:
            return [
                json.loads(line)
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
        except json.JSONDecodeError as error:
            raise EvalServiceError(f"Invalid JSONL file: {relative_path}") from error

    def _load_quality_gates(self) -> dict[str, Any]:
        path = self.root / "evals" / "quality_gates.yaml"
        if not path.exists():
            return {}
        return self._parse_simple_yaml(path.read_text(encoding="utf-8"))

    def _load_prompt(self, prompt_id: str) -> str:
        candidates = [
            self.root / "prompts" / f"{prompt_id}.md",
            self.root / "prompts" / f"{prompt_id.replace('-', '_')}.md",
        ]
        for path in candidates:
            if path.exists():
                return path.read_text(encoding="utf-8")
        return ""

    def _resolve_project_path(self, relative_path: str) -> Path:
        candidate = (self.root / relative_path).resolve()
        try:
            candidate.relative_to(self.root.resolve())
        except ValueError as error:
            raise EvalServiceError("Eval path must stay inside the project") from error
        return candidate

    def _aggregate_results(self, results: list[EvalCaseResult]) -> dict[str, float]:
        total = len(results)
        passed = sum(1 for result in results if result.passed)
        return {
            "cases_total": float(total),
            "cases_passed": float(passed),
            "pass_rate": float(passed / total) if total else 0.0,
        }

    def _response(
        self,
        eval_type: str,
        passed: bool,
        metrics: dict[str, float],
        gates: dict[str, Any],
        results: list[EvalCaseResult],
    ) -> dict[str, Any]:
        return {
            "eval_type": eval_type,
            "passed": passed,
            "pass_rate": metrics["pass_rate"],
            "cases_total": int(metrics["cases_total"]),
            "cases_passed": int(metrics["cases_passed"]),
            "metrics": metrics,
            "quality_gates": gates,
            "results": [result.model_dump() for result in results],
        }

    def _passed(self, results: list[EvalCaseResult]) -> bool:
        return bool(results) and all(result.passed for result in results)

    def _passes_prompt_injection_check(self, value: str) -> bool:
        lowered = value.lower()
        blocked = ("ignore previous", "ignore all previous", "system prompt", "developer message")
        return not any(term in lowered for term in blocked)

    def _parse_simple_yaml(self, text: str) -> dict[str, Any]:
        root: dict[str, Any] = {}
        current: dict[str, Any] | None = None
        for raw_line in text.splitlines():
            if not raw_line.strip() or raw_line.lstrip().startswith("#"):
                continue
            if not raw_line.startswith(" ") and raw_line.endswith(":"):
                key = raw_line.strip().removesuffix(":")
                current = {}
                root[key] = current
                continue
            key, _, value = raw_line.strip().partition(":")
            parsed = self._parse_yaml_scalar(value.strip())
            if current is None:
                root[key] = parsed
            else:
                current[key] = parsed
        return root

    def _parse_yaml_scalar(self, value: str) -> Any:
        if value in ("true", "false"):
            return value == "true"
        try:
            return float(value)
        except ValueError:
            return value
