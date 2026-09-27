"""Runtime guardrails from guardrails/policy.yaml, applied to live model traffic.

``InputGuard`` blocks secrets always and personal data for external providers
(``pii_check`` / config/model_providers.json sensitive_content). ``OutputGuard``
applies the output rules before an answer reaches the user:

- personal data or secrets in the answer -> block;
- ``schema_validation``: when a schema is given, the answer must be JSON with the
  required keys and types -> block otherwise;
- ``citations_for_rag``: when sources are given, the answer must cite at least
  one source id -> clarify otherwise;
- ``unsupported_claim_policy`` (block_or_clarify): numbers stated in the answer
  that appear in none of the grounding texts -> clarify.

Deterministic and standard-library only; evals use the same rules
(scripts/synapse_lib/eval_service.py) so offline and online behavior agree.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from scripts.synapse_lib.fine_tuning_service import PII_PATTERNS, SECRET_PATTERNS

ALLOW = "allow"
BLOCK = "block"
CLARIFY = "clarify"
NUMBER = re.compile(r"(?<![\w.])\d+(?:[.,]\d+)*(?:%)?")
JSON_TYPES = {"string": str, "number": (int, float), "integer": int, "boolean": bool, "object": dict, "array": list}


@dataclass
class GuardResult:
    action: str
    findings: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return self.action == ALLOW

    def as_dict(self) -> dict[str, Any]:
        return {"action": self.action, "passed": self.passed, "findings": self.findings}


def find_secrets(text: str) -> list[str]:
    return sorted(name for name, pattern in SECRET_PATTERNS.items() if pattern.search(text))


def find_pii(text: str) -> list[str]:
    return sorted(name for name, pattern in PII_PATTERNS.items() if pattern.search(text))


class InputGuard:
    def __init__(self, block_pii_for_external: bool = True) -> None:
        self.block_pii_for_external = block_pii_for_external

    def check(self, text: str, external_provider: bool = True) -> GuardResult:
        findings = [f"secret:{name}" for name in find_secrets(text)]
        if external_provider and self.block_pii_for_external:
            findings += [f"pii:{name}" for name in find_pii(text)]
        return GuardResult(BLOCK if findings else ALLOW, findings)


class OutputGuard:
    def check(
        self,
        text: str,
        schema: dict[str, Any] | None = None,
        sources: list[str] | None = None,
        grounding_texts: list[str] | None = None,
    ) -> GuardResult:
        blocking = [f"secret:{name}" for name in find_secrets(text)] + [f"pii:{name}" for name in find_pii(text)]
        if schema is not None:
            blocking += self._schema_problems(text, schema)
        if blocking:
            return GuardResult(BLOCK, blocking)

        clarify: list[str] = []
        if sources and not any(source and source in text for source in sources):
            clarify.append("citation_missing: answer must cite at least one retrieved source id")
        if grounding_texts is not None:
            grounded = " ".join(grounding_texts)
            unsupported = [value for value in NUMBER.findall(text) if value not in grounded]
            if unsupported:
                clarify.append(f"unsupported_claim: numbers not found in sources: {', '.join(sorted(set(unsupported)))}")
        return GuardResult(CLARIFY if clarify else ALLOW, clarify)

    def _schema_problems(self, text: str, schema: dict[str, Any]) -> list[str]:
        try:
            value = json.loads(text)
        except json.JSONDecodeError:
            return ["schema: answer is not valid JSON"]
        expected = JSON_TYPES.get(schema.get("type", "object"))
        if expected and not isinstance(value, expected):
            return [f"schema: expected {schema.get('type', 'object')}"]
        problems = []
        if isinstance(value, dict):
            for key in schema.get("required", []):
                if key not in value:
                    problems.append(f"schema: missing required key {key}")
            for key, spec in schema.get("properties", {}).items():
                kind = JSON_TYPES.get(spec.get("type", ""))
                if key in value and kind and (not isinstance(value[key], kind) or (kind is int and isinstance(value[key], bool))):
                    problems.append(f"schema: {key} must be {spec['type']}")
        return problems
