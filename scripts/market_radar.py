from __future__ import annotations

import argparse
import html
import json
import re
import urllib.request
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Iterable

try:
    from scripts.context_filter import filter_context
except ModuleNotFoundError:
    from context_filter import filter_context


SOURCES = {
    "hacker_news_show": "https://news.ycombinator.com/show",
    "product_hunt": "https://www.producthunt.com/",
}

FALLBACK_SIGNALS = [
    {
        "source": "hacker_news_show",
        "title": "Show HN: Lowfat - pluggable CLI filter that saved LLM tokens",
        "url": "https://news.ycombinator.com/show",
    },
    {
        "source": "hacker_news_show",
        "title": "Show HN: Nightwatch, the open-source, read-only AI SRE",
        "url": "https://news.ycombinator.com/show",
    },
    {
        "source": "hacker_news_show",
        "title": "Show HN: Web Speed - shared web-map registry for AI agents and MCP",
        "url": "https://news.ycombinator.com/show",
    },
    {
        "source": "product_hunt",
        "title": "Browse.sh - Give your agents muscle memory for automating the web",
        "url": "https://www.producthunt.com/",
    },
    {
        "source": "product_hunt",
        "title": "Forum: How do you stay aware of what your AI coding agents are doing?",
        "url": "https://www.producthunt.com/",
    },
]

CATEGORIES = {
    "cost_optimization": ("token", "cost", "cache", "lowfat", "usage-based", "burndown"),
    "agents": ("agent", "agents", "ai coding", "claude", "artifact"),
    "rag_mcp": ("mcp", "web-map", "registry", "rag", "knowledge"),
    "observability": ("sre", "status", "aware", "monitor", "rate-limit", "burndown"),
    "web_automation": ("browser", "automating the web", "web", "muscle memory"),
    "ux_product": ("ui", "ux", "product", "no browser", "no cloud", "workflow"),
    "ml_data": ("database", "data", "learning infrastructure", "analytics"),
}


@dataclass
class RadarSignal:
    source: str
    title: str
    url: str
    categories: list[str]
    priority: str
    synapse_action: str


def fetch_text(url: str, timeout: int = 20) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "SYNAPSEMarketRadar/1.0 (+https://news.ycombinator.com/show)",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def extract_hn_signals(raw_html: str) -> list[dict[str, str]]:
    titles = re.findall(r">([^<]*Show HN:[^<]+)</a>", raw_html)
    return [
        {"source": "hacker_news_show", "title": html.unescape(title).strip(), "url": SOURCES["hacker_news_show"]}
        for title in titles[:20]
    ]


def extract_product_hunt_signals(raw_html: str) -> list[dict[str, str]]:
    candidates = re.findall(r">\s*([A-Z][^<>]{8,120})\s*</a>|#\s*([^<>\n]{8,120})", raw_html)
    titles = []
    for first, second in candidates:
        title = html.unescape(first or second).strip()
        if title and title not in titles:
            titles.append(title)
    useful = [
        title for title in titles
        if any(keyword in title.lower() for keyword in ("agent", "ai", "llm", "workflow", "code", "automation", "data"))
    ]
    return [
        {"source": "product_hunt", "title": title, "url": SOURCES["product_hunt"]}
        for title in useful[:20]
    ]


def classify_signal(item: dict[str, str]) -> RadarSignal:
    text = item["title"].lower()
    categories = [
        category for category, keywords in CATEGORIES.items()
        if any(keyword in text for keyword in keywords)
    ] or ["ux_product"]
    priority = "high" if {"cost_optimization", "observability", "rag_mcp"} & set(categories) else "medium"
    return RadarSignal(
        source=item["source"],
        title=item["title"],
        url=item["url"],
        categories=categories,
        priority=priority,
        synapse_action=recommend_action(categories, item["title"]),
    )


def recommend_action(categories: Iterable[str], title: str) -> str:
    category_set = set(categories)
    if "cost_optimization" in category_set:
        return "Evaluate as input to the Context Filter and cost-aware routing policy."
    if "observability" in category_set:
        return "Evaluate for Ruflo agent telemetry, read-only AI SRE, and operational dashboards."
    if "rag_mcp" in category_set:
        return "Evaluate for MCP registry, web knowledge maps, and RAG connector design."
    if "web_automation" in category_set:
        return "Evaluate as repeatable web automation memory for agents."
    if "agents" in category_set:
        return "Evaluate for agent orchestration, handoff, task visibility, and local execution."
    if "ml_data" in category_set:
        return "Evaluate for data contracts, market datasets, and ML workflow templates."
    return f"Review product pattern for Synapse UX: {title[:64]}"


def collect_signals(offline: bool = False) -> tuple[list[RadarSignal], dict[str, str]]:
    raw_sources: dict[str, str] = {}
    items: list[dict[str, str]] = []

    if not offline:
        try:
            hn = fetch_text(SOURCES["hacker_news_show"])
            raw_sources["hacker_news_show"] = hn
            items.extend(extract_hn_signals(hn))
        except Exception as error:
            raw_sources["hacker_news_show_error"] = str(error)

        try:
            ph = fetch_text(SOURCES["product_hunt"])
            raw_sources["product_hunt"] = ph
            items.extend(extract_product_hunt_signals(ph))
        except Exception as error:
            raw_sources["product_hunt_error"] = str(error)

    if not items:
        items = FALLBACK_SIGNALS

    signals = [classify_signal(item) for item in items]
    signals.sort(key=lambda signal: (signal.priority != "high", signal.source, signal.title.lower()))
    return signals, raw_sources


def write_outputs(
    signals: list[RadarSignal],
    raw_sources: dict[str, str] | None = None,
    today: date | None = None,
) -> dict[str, str]:
    today = today or date.today()
    raw_sources = raw_sources or {}
    docs_dir = Path("docs/radar")
    output_dir = Path("output/market_radar")
    docs_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    md_path = docs_dir / f"{today.isoformat()}.md"
    json_path = output_dir / f"{today.isoformat()}.json"

    report = {
        "date": today.isoformat(),
        "sources": SOURCES,
        "signals": [asdict(signal) for signal in signals],
        "raw_source_status": {key: len(value) for key, value in raw_sources.items()},
    }
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    lines = [
        f"# Synapse Market Radar - {today.isoformat()}",
        "",
        "## Prioridades",
        "",
    ]
    for signal in signals:
        lines.extend(
            [
                f"- **{signal.priority.upper()}** `{', '.join(signal.categories)}` - {signal.title}",
                f"  - Fonte: {signal.source} ({signal.url})",
                f"  - Acao synapse: {signal.synapse_action}",
            ]
        )
    if raw_sources:
        compact_source, compact_report = filter_context("\n\n".join(raw_sources.values()), max_chars=4000)
        lines.extend(
            [
                "",
                "## Contexto Filtrado",
                "",
                f"- Reducao estimada: {compact_report.reduction_ratio:.2%}",
                f"- Linhas filtradas: {compact_report.input_lines} -> {compact_report.output_lines}",
                "",
                "```text",
                compact_source[:4000],
                "```",
            ]
        )
    md_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
    return {"markdown": str(md_path), "json": str(json_path)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Collect market signals for Synapse from HN Show and Product Hunt.")
    parser.add_argument("--offline", action="store_true", help="Use embedded seed signals instead of fetching the web.")
    args = parser.parse_args(argv)

    signals, raw_sources = collect_signals(offline=args.offline)
    outputs = write_outputs(signals, raw_sources)
    print(json.dumps({"signals": len(signals), **outputs}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
