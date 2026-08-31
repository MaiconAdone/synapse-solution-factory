---
name: book-to-skill
description: Convert a long doc (book, spec, governance doc) into a chapter-indexed skill pack that loads on demand instead of dumping the whole text into context. Adapted from github.com/virgiliojr94/book-to-skill.
---

# Book to Skill

Turns a large Markdown/text source into a structured skill pack under `docs/books/<skill-name>/`, then registers a thin invokable command that points at it. The goal is the same one behind `scripts/context_filter.py`: load only the slice of content a question actually needs, not the whole document.

Scope: plain text and Markdown sources (specs, governance docs, long READMEs, `docs/architecture/*`, `docs/specifications/*`). This project's long documents are already Markdown, so no PDF/EPUB/DOCX extraction step is needed — if the user hands you a PDF/DOCX, ask them to point you at a Markdown/text export, or use the upstream `book-to-skill` CLI instead.

## Usage

`/book-to-skill <path|folder|glob> [skill-name]`

## Steps

1. **Read the source(s).** Use Glob/Read to pull in every file matched by the path/glob.
2. **Derive `skill-name`** from the arg, or slugify the source's title/filename if omitted.
3. **Split into chapters.** Break the source at its natural headings/sections. Write each as `docs/books/<skill-name>/chapters/chNN-<slug>.md`, self-contained enough to read in isolation (~800-1200 tokens each is a good target — split further if a section runs long).
4. **Write `docs/books/<skill-name>/SKILL.md`** (~aim for well under 4k tokens): a short index — one line per chapter describing what it covers and when to load it, plus any cross-cutting mental models that don't belong to one chapter.
5. **Write `docs/books/<skill-name>/glossary.md`**: alphabetized key terms, each with a one-line definition and a pointer to the chapter(s) that expand on it.
6. **Write `docs/books/<skill-name>/patterns.md`**: recurring techniques, algorithms, or decision patterns pulled from across chapters, deduplicated.
7. **Write `docs/books/<skill-name>/cheatsheet.md`**: a quick-reference table (decision rules, defaults, thresholds) for the most common questions — this is usually enough to answer a question without opening a chapter.
8. **Register the command.** Write `.claude/commands/<skill-name>.md` with frontmatter `name`/`description` and a body that says: read `docs/books/<skill-name>/cheatsheet.md` and `SKILL.md` first; open a specific chapter only if those don't answer the question.

## Why this shape

- The index + cheatsheet answer most questions without opening a chapter.
- Chapters stay unloaded until a question actually needs them — this is the same "small, specific, filtered context" rule from this project's Anthropic usage guidance, applied to long docs instead of tool output.
- Don't regenerate a skill pack that already exists; if the source changed, diff it first and patch only the affected chapter(s) plus the index/glossary/cheatsheet entries that reference them.
