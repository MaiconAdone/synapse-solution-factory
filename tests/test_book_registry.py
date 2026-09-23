"""The book registry is the single source for book-grounded and own (off-book) decisions."""

import json
import re
import subprocess
import sys
from pathlib import Path

from scripts.synapse_lib.business_solution_analyzer import BusinessSolutionAnalyzer

ROOT = Path(__file__).resolve().parents[1]
UNIVERSES = {"ml", "ia", "chatbolt", "hybrid"}


def load(relative_path):
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8-sig"))


def registry():
    return load("config/book_registry.json")


def test_every_registry_entry_is_applied_somewhere_that_exists():
    data = registry()
    ids = [item["id"] for item in data["books"] + data["own_implementations"]]
    assert len(ids) == len(set(ids)), "duplicate ids"
    for kind in ("books", "own_implementations"):
        for item in data[kind]:
            assert item["applied_in"], item["id"]
            for path in item["applied_in"]:
                assert (ROOT / path).exists(), (item["id"], path)
    for book in data["books"]:
        assert book["authors"] and book["lessons"], book["id"]
        assert set(book["universes"]) <= UNIVERSES and book["universes"], book["id"]


def test_every_universe_is_grounded_in_ml_statistics_and_ai_books():
    books = registry()["books"]
    for universe in UNIVERSES:
        domains = {domain for book in books if universe in book["universes"] for domain in book["domains"]}
        assert {"agents", "evaluation"} <= domains, universe
        if universe in {"ml", "hybrid"}:
            assert {"ml", "statistics"} <= domains, universe
        if universe in {"ia", "chatbolt", "hybrid"}:
            assert "ia" in domains, universe


def test_implementation_map_and_spec_are_in_sync_with_registry():
    completed = subprocess.run(
        [sys.executable, "scripts/sync_book_registry.py", "--check"], cwd=ROOT, capture_output=True, text=True, timeout=60, check=False
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    imap = (ROOT / "docs/books/implementation_map.md").read_text(encoding="utf-8-sig")
    for book in registry()["books"]:
        assert f"*{book['title']}*" in imap, book["title"]
    for item in registry()["own_implementations"]:
        assert f"`{item['id']}`" in imap, item["id"]


def _registered(name: str, titles: list[str]) -> bool:
    name = name.strip().lower()
    return any(name in title.lower() or title.lower().startswith(name) for title in titles)


def test_books_cited_by_catalog_and_analyzer_are_registered():
    titles = [book["title"] for book in registry()["books"]]
    for line in load("config/ai_framework_selection.json")["book_alignment"]:
        assert _registered(line.split(" - ")[0], titles), line

    analyzer = BusinessSolutionAnalyzer(root=ROOT)
    voice = analyzer.analyze(
        project_goal="programacao por voz",
        business_problem="Reconhecimento de voz e edicao de codigo agentiva no IDE com testes e rollback.",
        requested_universe="hybrid",
        solution_focus="voice coding agent",
    )
    for line in voice["book_alignment"]:
        head = line.split(":")[0]
        cited = re.findall(r"\(([^)]*)\)", head)
        names = [name for group in cited for name in group.split(",")] if cited else [head]
        generic = {"AI Engineering", "Designing ML Systems/MLOps", "LLM engineering", "Agent architecture", "Agentic Coding"}
        for name in names:
            if name.strip() in generic:
                continue
            assert _registered(name, titles), (name, line)


def test_production_llm_book_uses_its_published_title():
    for path in ("config/ai_framework_selection.json", "config/ai_ml_enterprise_spec.json", "README.md", "docs/books/implementation_map.md"):
        text = (ROOT / path).read_text(encoding="utf-8-sig")
        assert "Production LLMs - Bouchard" not in text and "*Production LLMs*, by" not in text, path
