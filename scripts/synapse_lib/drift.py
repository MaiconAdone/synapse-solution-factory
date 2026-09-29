"""Data and prediction drift monitoring (config/cicd_policy.json -> drift).

Population Stability Index per feature between the training/reference data and
current production data:

    PSI = sum((cur% - ref%) * ln(cur% / ref%))   over bins

Numeric features use quantile bins of the reference; categorical features use
their categories. PSI >= ``psi_threshold`` (default 0.2) is drift, >= ``psi_warning``
(0.1) is a warning. On drift the monitor appends a retraining request pending
human approval and captures a failure in the improvement loop - it never retrains
(ml_systems/monitoring_plan.yaml: retraining_trigger needs an approved breach).

Standard library only; reads CSV or JSONL.
"""

from __future__ import annotations

import csv
import json
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

EPSILON = 1e-4


class DriftError(ValueError):
    pass


def load_table(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise DriftError(f"dataset not found: {path}")
    if path.suffix.lower() == ".jsonl":
        return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _as_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _distribution_psi(ref_counts: list[int], cur_counts: list[int]) -> float:
    ref_total, cur_total = sum(ref_counts) or 1, sum(cur_counts) or 1
    total = 0.0
    for ref, cur in zip(ref_counts, cur_counts):
        ref_share = max(ref / ref_total, EPSILON)
        cur_share = max(cur / cur_total, EPSILON)
        total += (cur_share - ref_share) * math.log(cur_share / ref_share)
    return total


def numeric_psi(reference: list[float], current: list[float], bins: int = 10) -> float:
    if not reference or not current:
        raise DriftError("numeric PSI needs values in both samples")
    ordered = sorted(reference)
    edges = sorted({ordered[min(len(ordered) - 1, int(len(ordered) * step / bins))] for step in range(1, bins)})

    def histogram(values: list[float]) -> list[int]:
        counts = [0] * (len(edges) + 1)
        for value in values:
            index = sum(1 for edge in edges if value > edge)
            counts[index] += 1
        return counts

    return _distribution_psi(histogram(reference), histogram(current))


def categorical_psi(reference: list[str], current: list[str]) -> float:
    categories = sorted(set(reference) | set(current))
    return _distribution_psi([reference.count(item) for item in categories], [current.count(item) for item in categories])


class DriftMonitor:
    def __init__(
        self,
        root: Path | None = None,
        policy: dict[str, Any] | None = None,
        capture: Callable[[dict[str, Any]], Any] | None = None,
    ) -> None:
        self.root = (root or Path(__file__).resolve().parents[2]).resolve()
        if policy is None:
            path = self.root / "config" / "cicd_policy.json"
            if not path.exists():
                path = Path(__file__).resolve().parents[2] / "config" / "cicd_policy.json"
            policy = json.loads(path.read_text(encoding="utf-8-sig"))["drift"]
        self.policy = policy
        self.capture = capture

    def compare(
        self,
        reference: list[dict[str, Any]],
        current: list[dict[str, Any]],
        features: list[str] | None = None,
        prediction_column: str | None = None,
    ) -> dict[str, Any]:
        minimum = int(self.policy.get("min_rows", 30))
        if len(reference) < minimum or len(current) < minimum:
            raise DriftError(f"need at least {minimum} rows in reference and current samples")
        columns = features or sorted(set(reference[0]) & set(current[0]))
        if prediction_column and prediction_column not in columns:
            columns.append(prediction_column)
        threshold = float(self.policy.get("psi_threshold", 0.2))
        warning = float(self.policy.get("psi_warning", 0.1))
        bins = int(self.policy.get("bins", 10))
        results = {}
        for column in columns:
            ref_values = [row.get(column) for row in reference]
            cur_values = [row.get(column) for row in current]
            ref_numbers = [n for n in map(_as_number, ref_values) if n is not None]
            cur_numbers = [n for n in map(_as_number, cur_values) if n is not None]
            if len(ref_numbers) >= 0.9 * len(ref_values) and cur_numbers:
                value, kind = numeric_psi(ref_numbers, cur_numbers, bins), "numeric"
            else:
                value = categorical_psi([str(v) for v in ref_values], [str(v) for v in cur_values])
                kind = "categorical"
            status = "drift" if value >= threshold else "warning" if value >= warning else "stable"
            results[column] = {
                "psi": round(value, 4),
                "kind": kind,
                "status": status,
                "signal": "prediction_drift" if column == prediction_column else "data_drift",
            }
        drifted = sorted(name for name, item in results.items() if item["status"] == "drift")
        return {
            "schema": "synapse-drift-report.v1",
            "metric": "population_stability_index",
            "threshold": threshold,
            "features": results,
            "drifted_features": drifted,
            "max_psi": max((item["psi"] for item in results.values()), default=0.0),
            "status": "drift" if drifted else "warning" if any(i["status"] == "warning" for i in results.values()) else "stable",
        }

    def check(
        self,
        reference_path: str,
        current_path: str,
        features: list[str] | None = None,
        prediction_column: str | None = None,
        model_id: str | None = None,
    ) -> dict[str, Any]:
        report = self.compare(
            load_table(self._inside(reference_path)), load_table(self._inside(current_path)), features, prediction_column
        )
        report.update({"reference": reference_path, "current": current_path, "model_id": model_id})
        if report["status"] == "drift":
            report["retraining_request"] = self._request_retraining(report)
            if self.capture is not None:
                self.capture(
                    {
                        "agent_id": "drift-monitor",
                        "outcome": "drift_detected",
                        "quality_passed": False,
                        "findings": [f"drift:{name}" for name in report["drifted_features"]],
                        "model": model_id,
                    }
                )
        return report

    def _request_retraining(self, report: dict[str, Any]) -> dict[str, Any]:
        request = {
            "request_id": uuid.uuid4().hex,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "model_id": report.get("model_id"),
            "drifted_features": report["drifted_features"],
            "max_psi": report["max_psi"],
            "status": "pending_human_approval",
            "next_step": "retrain via the ml-release workflow, then python scripts/synapse_ci.py pipeline",
        }
        path = self.root / self.policy.get("retraining_requests", "artifacts/cicd/retraining_requests.jsonl")
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(request, ensure_ascii=False) + "\n")
        return request

    def _inside(self, relative: str) -> Path:
        path = (self.root / relative).resolve()
        try:
            path.relative_to(self.root)
        except ValueError as error:
            raise DriftError("dataset paths must stay inside the project") from error
        return path
