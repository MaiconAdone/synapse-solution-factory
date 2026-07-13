import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.business_solution_analyzer import BusinessSolutionAnalyzer  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze the best Synapse architecture for a business problem.")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--project-name", required=True)
    parser.add_argument("--universe", required=True)
    parser.add_argument("--project-goal", default="")
    parser.add_argument("--business-problem", default="")
    parser.add_argument("--solution-focus", default="")
    parser.add_argument("--success-metric", default="")
    parser.add_argument("--available-sources", default="")
    parser.add_argument("--risk-level", default="")
    args = parser.parse_args()

    analyzer = BusinessSolutionAnalyzer(root=ROOT)
    analysis = analyzer.analyze(
        project_goal=args.project_goal,
        business_problem=args.business_problem,
        requested_universe=args.universe,
        solution_focus=args.solution_focus,
        success_metric_or_acceptance_criteria=args.success_metric,
        available_data_or_knowledge_sources=args.available_sources,
        risk_level=args.risk_level,
    )
    analysis["project"] = args.project_name
    analysis["source"] = "scripts/analyze_business_solution.py"

    project_root = Path(args.project_root)
    config_path = project_root / "config" / "business_solution_analysis.json"
    docs_path = project_root / "docs" / "briefings" / "business_solution_analysis.md"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    docs_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(analysis, indent=2, ensure_ascii=False), encoding="utf-8")
    docs_path.write_text(analyzer.to_markdown(analysis), encoding="utf-8")
    print(json.dumps({"ok": True, "analysis": str(config_path), "briefing": str(docs_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
