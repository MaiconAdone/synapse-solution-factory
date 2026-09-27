"""Release gate and model registry for fine-tuned models (config/fine_tuning_policy.json).

``FineTuningReleaseGate`` compares a candidate against the prompt + RAG baseline
measured on the same eval set and applies every ``release_gates`` rule. It
never trains, never calls a provider and never switches traffic: an approved
decision only allows a human to register the model and start a shadow/canary
rollout. ``ModelRegistry`` appends approved records with the policy's
``record_fields`` and the rollback target.

Standard library only: the project factory runs it with the ``python`` on PATH.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from scripts.synapse_lib.fine_tuning_service import FineTuningError, load_policy

# Metrics where lower is better; everything else is higher-is-better.
LOWER_IS_BETTER = {"cost_per_1k_requests", "p95_latency_ms"}


class FineTuningReleaseGate:
    def __init__(self, policy: dict[str, Any] | None = None, root: Path | None = None) -> None:
        self.policy = policy if policy is not None else load_policy(root)
        self.gates = self.policy["release_gates"]

    def evaluate(self, candidate: dict[str, Any]) -> dict[str, Any]:
        """Return {decision, checks, reasons}; ``approved`` only when every check passes."""
        baseline = candidate.get("baseline", {}).get("metrics", {})
        tuned = candidate.get("candidate", {}).get("metrics", {})
        primary = candidate.get("primary_metric", "task_success")
        budget = candidate.get("budget", {})
        checks: dict[str, bool] = {}
        reasons: list[str] = []

        def check(name: str, passed: bool, reason: str) -> None:
            checks[name] = passed
            if not passed:
                reasons.append(reason)

        check(
            "same_eval_set",
            bool(candidate.get("eval_set_hash"))
            and candidate.get("baseline", {}).get("eval_set_hash") == candidate.get("eval_set_hash")
            and candidate.get("candidate", {}).get("eval_set_hash") == candidate.get("eval_set_hash"),
            "baseline and candidate must be measured on the same eval set (eval_set_hash)",
        )
        base_value, tuned_value = baseline.get(primary), tuned.get(primary)
        improvement = None
        if isinstance(base_value, (int, float)) and isinstance(tuned_value, (int, float)) and base_value > 0:
            improvement = (tuned_value - base_value) / base_value
        minimum = float(self.gates["min_relative_improvement_over_baseline"])
        check(
            "min_relative_improvement",
            improvement is not None and improvement >= minimum,
            f"{primary} must improve at least {minimum:.0%} over the baseline (got {improvement if improvement is None else f'{improvement:.1%}'})",
        )
        for metric in self.gates["no_regression_on"]:
            present = metric in baseline and metric in tuned
            check(
                f"no_regression_{metric}",
                present and float(tuned[metric]) >= float(baseline[metric]),
                f"{metric} must be measured for both and must not regress",
            )
        if self.gates.get("cost_and_latency_within_budget"):
            for metric in sorted(LOWER_IS_BETTER):
                limit = budget.get(f"{metric}_max")
                check(
                    f"budget_{metric}",
                    limit is not None and metric in tuned and float(tuned[metric]) <= float(limit),
                    f"{metric} must be measured and within budget ({metric}_max)",
                )
        if self.gates.get("model_card_updated"):
            check("model_card_updated", candidate.get("model_card_updated") is True, "model card must be updated")
        if self.gates.get("human_approval_required"):
            check("human_approval", bool(str(candidate.get("approver", "")).strip()), "a named human approver is required")
        check(
            "rollout_shadow_or_canary",
            candidate.get("rollout") in {"shadow", "canary"},
            "rollout must start as shadow or canary",
        )
        check("rollback_target", bool(candidate.get("rollback_target")), "rollback_target (base model routing) is required")
        check("dataset_traceable", bool(candidate.get("dataset_hash")), "dataset_hash of the curated dataset is required")
        check(
            "no_automatic_weight_updates",
            self.policy["provider_rules"]["automatic_weight_updates"] is False and not candidate.get("auto_deploy"),
            "automatic deploy or weight updates are forbidden",
        )
        return {
            "schema": "synapse-fine-tuning-release.v1",
            "decision": "approved_for_rollout" if all(checks.values()) else "blocked",
            "primary_metric": primary,
            "relative_improvement": improvement,
            "checks": checks,
            "reasons": reasons,
            "rollout": self.gates["rollout"],
            "rollback": self.gates["rollback"],
        }


class ModelRegistry:
    """Append-only registry at the policy's artifacts path; only approved releases are recorded."""

    def __init__(self, root: Path, policy: dict[str, Any] | None = None) -> None:
        self.root = root.resolve()
        self.policy = policy if policy is not None else load_policy(root)
        self.path = self.root / self.policy["registry"]["artifacts_path"] / "registry.jsonl"

    def register(self, candidate: dict[str, Any], decision: dict[str, Any]) -> dict[str, Any]:
        if decision.get("decision") != "approved_for_rollout":
            raise FineTuningError("only releases approved by the gate can be registered")
        record = {
            "base_model": candidate.get("base_model"),
            "technique": candidate.get("technique"),
            "dataset_hash": candidate.get("dataset_hash"),
            "dataset_card": candidate.get("dataset_card"),
            "hyperparameters": candidate.get("hyperparameters", {}),
            "eval_results": {
                "baseline": candidate.get("baseline", {}).get("metrics", {}),
                "candidate": candidate.get("candidate", {}).get("metrics", {}),
                "relative_improvement": decision.get("relative_improvement"),
            },
            "approver": candidate.get("approver"),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "rollback_target": candidate.get("rollback_target"),
        }
        missing = [name for name in self.policy["registry"]["record_fields"] if record.get(name) in (None, "")]
        if missing:
            raise FineTuningError(f"registry record missing fields: {', '.join(missing)}")
        record["record_id"] = hashlib.sha256(json.dumps(record, sort_keys=True).encode("utf-8")).hexdigest()[:16]
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        return record

    def records(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        return [json.loads(line) for line in self.path.read_text(encoding="utf-8").splitlines() if line.strip()]


def run_release_cases(root: Path, cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each case holds a candidate and the expected decision (and optionally failing checks)."""
    gate = FineTuningReleaseGate(root=root)
    results = []
    for case in cases:
        decision = gate.evaluate(case["candidate_release"])
        expected_failures = set(case.get("expected_failed_checks", []))
        failed = {name for name, passed in decision["checks"].items() if not passed}
        results.append(
            {
                "id": case.get("id", "unknown"),
                "passed": decision["decision"] == case.get("expected_decision") and expected_failures <= failed,
                "decision": decision["decision"],
                "failed_checks": sorted(failed),
            }
        )
    return results
