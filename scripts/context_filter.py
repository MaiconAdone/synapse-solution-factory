from __future__ import annotations

import argparse
import fnmatch
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path


DEFAULT_POLICY_PATH = Path("config") / "context_policy.json"

NOISE_PATTERNS = [
    re.compile(r"node_modules[\\/]", re.IGNORECASE),
    re.compile(r"\.next[\\/]", re.IGNORECASE),
    re.compile(r"\.pytest_cache[\\/]", re.IGNORECASE),
    re.compile(r"package-lock\.json", re.IGNORECASE),
    re.compile(r"^\s*(DEBUG|TRACE)\b", re.IGNORECASE),
    re.compile(r"^\s*(at\s+[\w.$<>]+\(|File\s+\".+\", line \d+)", re.IGNORECASE),
    re.compile(r"^[A-Za-z0-9+/]{120,}={0,2}$"),
    re.compile(r"^\s*$"),
]


def load_context_policy(path: Path = DEFAULT_POLICY_PATH) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _normalize_path(value: str) -> str:
    return value.replace("\\", "/").strip("/").lower()


def is_ignored_path(path_value: str, policy: dict | None = None) -> bool:
    policy = policy or load_context_policy()
    normalized = _normalize_path(path_value)
    parts = normalized.split("/") if normalized else []
    ignored_dirs = {_normalize_path(item) for item in policy.get("ignored_directories", [])}
    for index in range(len(parts)):
        suffix = "/".join(parts[index:])
        if parts[index] in ignored_dirs or suffix in ignored_dirs:
            return True
    ignored_globs = policy.get("ignored_file_globs", [])
    sensitive_globs = policy.get("sensitive_file_globs", [])
    return any(fnmatch.fnmatch(normalized, pattern.lower()) for pattern in ignored_globs + sensitive_globs)


def compile_policy_patterns(policy: dict, key: str, fallback: list[re.Pattern]) -> list[re.Pattern]:
    patterns = policy.get(key)
    if not patterns:
        return fallback
    return [re.compile(pattern, re.IGNORECASE) for pattern in patterns]


def line_matches_ignored_directory(line: str, policy: dict) -> bool:
    normalized = _normalize_path(line.strip())
    if not normalized:
        return False
    ignored_dirs = [_normalize_path(item) for item in policy.get("ignored_directories", [])]
    return any(
        normalized == item or normalized.startswith(f"{item}/") or f"/{item}/" in f"/{normalized}/"
        for item in ignored_dirs
    )

KEEP_PATTERNS = [
    re.compile(r"\b(error|failed|exception|traceback|assert|warning)\b", re.IGNORECASE),
    re.compile(r"\b(todo|fixme|security|cost|token|agent|rag|mcp)\b", re.IGNORECASE),
    re.compile(r"^\s*(def|class|function|param|import|from|export|type|interface)\b"),
    re.compile(r"^\s*[-*]\s+"),
]


@dataclass
class FilterReport:
    input_chars: int
    output_chars: int
    removed_chars: int
    input_lines: int
    output_lines: int
    removed_lines: int
    reduction_ratio: float
    max_chars: int


def filter_context(text: str, max_chars: int = 12000, policy: dict | None = None) -> tuple[str, FilterReport]:
    policy = policy or load_context_policy()
    noise_patterns = compile_policy_patterns(policy, "line_noise_patterns", NOISE_PATTERNS)
    keep_patterns = compile_policy_patterns(policy, "line_keep_patterns", KEEP_PATTERNS)
    lines = text.splitlines()
    selected: list[str] = []
    seen: set[str] = set()

    for line in lines:
        normalized = line.strip()
        if normalized in seen:
            continue
        seen.add(normalized)

        is_noise = any(pattern.search(line) for pattern in noise_patterns) or line_matches_ignored_directory(line, policy)
        is_keep = any(pattern.search(line) for pattern in keep_patterns)
        if is_noise and not is_keep:
            continue
        selected.append(line.rstrip())

    filtered = "\n".join(selected).strip()
    if len(filtered) > max_chars:
        head_budget = max_chars * 2 // 3
        tail_budget = max_chars - head_budget
        filtered = (
            filtered[:head_budget].rstrip()
            + "\n\n[... context compressed by Synapse Context Filter ...]\n\n"
            + filtered[-tail_budget:].lstrip()
        )

    report = FilterReport(
        input_chars=len(text),
        output_chars=len(filtered),
        removed_chars=max(len(text) - len(filtered), 0),
        input_lines=len(lines),
        output_lines=len(filtered.splitlines()) if filtered else 0,
        removed_lines=max(len(lines) - len(filtered.splitlines()), 0),
        reduction_ratio=round(1 - (len(filtered) / len(text)), 4) if text else 0.0,
        max_chars=max_chars,
    )
    return filtered, report


def write_report(report: FilterReport, output_path: Path) -> None:
    report_path = output_path.with_suffix(output_path.suffix + ".report.json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(asdict(report), indent=2), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Filter noisy context before LLM/Ruflo calls.")
    parser.add_argument("--input", help="Input file. Reads stdin when omitted.")
    parser.add_argument("--output", default="output/context_filter/filtered_context.txt")
    parser.add_argument("--max-chars", type=int, default=12000)
    parser.add_argument("--policy", default=str(DEFAULT_POLICY_PATH))
    args = parser.parse_args(argv)
    policy = load_context_policy(Path(args.policy))

    if args.input:
        if is_ignored_path(args.input, policy):
            filtered, report = "", FilterReport(
                input_chars=0,
                output_chars=0,
                removed_chars=0,
                input_lines=0,
                output_lines=0,
                removed_lines=0,
                reduction_ratio=1.0,
                max_chars=args.max_chars,
            )
            output_path = Path(args.output)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(filtered, encoding="utf-8")
            write_report(report, output_path)
            print(json.dumps(asdict(report), ensure_ascii=False))
            return 0
        text = Path(args.input).read_text(encoding="utf-8-sig", errors="replace")
    else:
        text = sys.stdin.read()

    filtered, report = filter_context(text, max_chars=args.max_chars, policy=policy)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(filtered, encoding="utf-8")
    write_report(report, output_path)
    print(json.dumps(asdict(report), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
