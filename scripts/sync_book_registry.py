"""Render config/book_registry.json into the docs and specs that list the books.

Usage:
    python scripts/sync_book_registry.py          # write
    python scripts/sync_book_registry.py --check  # exit 1 if anything is out of sync
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP_PATH = ROOT / "docs" / "books" / "implementation_map.md"
SPEC_PATH = ROOT / "config" / "ai_ml_enterprise_spec.json"
START = "<!-- book-registry:start -->"
END = "<!-- book-registry:end -->"


def load_registry(root: Path = ROOT) -> dict:
    return json.loads((root / "config" / "book_registry.json").read_text(encoding="utf-8-sig"))


def render_section(registry: dict) -> str:
    lines = [
        START,
        "## Registro De Livros",
        "",
        "Gerado de `config/book_registry.json` por `scripts/sync_book_registry.py`; edite o registro, nao esta tabela.",
        "",
        "| Livro | Autores | Dominios | Universos | Aplicado em |",
        "|-------|---------|----------|-----------|-------------|",
    ]
    for book in registry["books"]:
        applied = ", ".join(f"`{path}`" for path in book["applied_in"])
        lines.append(
            f"| *{book['title']}* | {book['authors']} | {', '.join(book['domains'])} | {', '.join(book['universes'])} | {applied} |"
        )
    lines += [
        "",
        "## Implementacao Propria (Fora Dos Livros)",
        "",
        "Decisoes de engenharia do Synapse e praticas de mercado que nao vem dos livros acima.",
        "Os livros dao os principios; estes numeros, regras e mecanismos sao ajustaveis.",
        "",
        "| Id | Decisao | Base | Aplicado em |",
        "|----|---------|------|-------------|",
    ]
    for item in registry["own_implementations"]:
        applied = ", ".join(f"`{path}`" for path in item["applied_in"])
        lines.append(f"| `{item['id']}` | {item['decision']} | {item['basis']} | {applied} |")
    lines.append(END)
    return "\n".join(lines)


def inspiration_sources(registry: dict) -> list[str]:
    return [f"{book['title']} - {book['authors']}" for book in registry["books"]]


def synced_map(text: str, section: str) -> str:
    if START in text and END in text:
        before = text[: text.index(START)]
        after = text[text.index(END) + len(END):]
        return before + section + after
    marker = "\n## AI Engineering"
    index = text.index(marker)
    return text[:index] + "\n" + section + "\n" + text[index:]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    registry = load_registry()
    map_text = MAP_PATH.read_text(encoding="utf-8-sig")
    new_map = synced_map(map_text, render_section(registry))
    spec = json.loads(SPEC_PATH.read_text(encoding="utf-8-sig"))
    sources = inspiration_sources(registry)

    out_of_sync = []
    if new_map != map_text:
        out_of_sync.append(str(MAP_PATH.relative_to(ROOT)))
    if spec.get("inspiration_sources") != sources:
        out_of_sync.append(str(SPEC_PATH.relative_to(ROOT)))
    if args.check:
        print(json.dumps({"ok": not out_of_sync, "out_of_sync": out_of_sync}))
        return 1 if out_of_sync else 0

    MAP_PATH.write_bytes(b"\xef\xbb\xbf" + new_map.encode("utf-8"))
    spec["inspiration_sources"] = sources
    SPEC_PATH.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "written": out_of_sync}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
