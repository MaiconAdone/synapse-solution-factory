"""Harness engineering checks driven by config/harness_engineering_policy.json.

``HarnessAuditor`` verifies that every harness component applicable to the
project's universe has its evidence in place. ``pass_at_k`` / ``pass_hat_k``
turn repeated agent trials into capability and reliability metrics.
"""

from __future__ import annotations

import json
from math import comb
from pathlib import Path
from typing import Any, Iterable

UNIVERSES = {"ml", "ia", "chatbolt", "hybrid"}


def pass_at_k(trials: int, successes: int, k: int) -> float:
    """Unbiased probability that at least one of k sampled trials succeeds."""
    _check_trials(trials, successes, k)
    if trials - successes < k:
        return 1.0
    return 1.0 - comb(trials - successes, k) / comb(trials, k)


def pass_hat_k(trials: int, successes: int, k: int) -> float:
    """Probability that all k sampled trials succeed (reliability, a.k.a. pass^k)."""
    _check_trials(trials, successes, k)
    return comb(successes, k) / comb(trials, k)


def _check_trials(trials: int, successes: int, k: int) -> None:
    if not 0 <= successes <= trials or not 1 <= k <= trials:
        raise ValueError("require 0 <= successes <= trials and 1 <= k <= trials")


def summarize_trials(case_outcomes: dict[str, Iterable[bool]], k: int) -> dict[str, Any]:
    """Average pass@k and pass^k over cases, each with n >= k recorded trials."""
    per_case = {}
    for case_id, outcomes in case_outcomes.items():
        results = list(outcomes)
        successes = sum(1 for item in results if item)
        per_case[case_id] = {
            "trials": len(results),
            "successes": successes,
            "pass_at_k": pass_at_k(len(results), successes, k),
            "pass_hat_k": pass_hat_k(len(results), successes, k),
        }
    count = len(per_case) or 1
    return {
        "k": k,
        "cases": per_case,
        "pass_at_k": sum(item["pass_at_k"] for item in per_case.values()) / count,
        "pass_hat_k": sum(item["pass_hat_k"] for item in per_case.values()) / count,
    }


class HarnessAuditor:
    def __init__(self, root: Path | None = None, policy: dict[str, Any] | None = None) -> None:
        self.root = (root or Path(__file__).resolve().parents[2]).resolve()
        if policy is None:
            path = self.root / "config" / "harness_engineering_policy.json"
            if not path.exists():
                path = Path(__file__).resolve().parents[2] / "config" / "harness_engineering_policy.json"
            policy = json.loads(path.read_text(encoding="utf-8-sig"))
        self.policy = policy

    def detect_universe(self) -> str:
        profile = self.root / "config" / "project_universe.json"
        if profile.exists():
            universe = json.loads(profile.read_text(encoding="utf-8-sig")).get("universe", "hybrid")
            return universe if universe in UNIVERSES else "hybrid"
        return "hybrid"

    def audit(self, universe: str | None = None) -> dict[str, Any]:
        selected = universe or self.detect_universe()
        if selected not in UNIVERSES:
            raise ValueError(f"unknown universe: {selected}")
        components = []
        for component in self.policy["components"]:
            if selected not in component["applies_to"]:
                continue
            missing = [path for path in component["evidence_all"] if not (self.root / path).exists()]
            components.append(
                {
                    "id": component["id"],
                    "goal": component["goal"],
                    "status": "ready" if not missing else "missing_evidence",
                    "missing": missing,
                }
            )
        ready = all(item["status"] == "ready" for item in components)
        return {
            "schema": "synapse-harness-audit.v1",
            "universe": selected,
            "harness_ready": ready,
            "score": sum(item["status"] == "ready" for item in components) / (len(components) or 1),
            "components": components,
            "eval_harness": {
                "trials_per_agent_case": self.policy["eval_harness"]["trials_per_agent_case"],
                "reliability_gate_pass_hat_k_min": self.policy["eval_harness"]["reliability_gate_pass_hat_k_min"],
            },
        }
