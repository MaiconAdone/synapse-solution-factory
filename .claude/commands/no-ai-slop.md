---
name: no-ai-slop
description: Remove AI-writing patterns from a draft while preserving the author's voice, or detect them without rewriting. Adapted from github.com/petergyang/no-ai-slop.
---

# No AI Slop

A sharp-editor pass that removes AI-typical writing patterns from a draft without flattening the author's voice. Use it on PR descriptions, docs, commit messages, `docs/radar/*.md`, or any prose this project generates for humans to read.

## Modes

- **Edit mode (default):** `/no-ai-slop <draft>` — make minimal, effective edits that sharpen clarity and cut AI patterns. Return the edited text plus a short "What changed" list.
- **Detect mode:** `/no-ai-slop is this slop? <draft>` — identify patterns without rewriting. For each hit: name the pattern, quote the line, suggest a fix in a few words. Do not speculate about whether the text was AI-written — assess the writing, not the authorship.

## Principles

- Preserve the writer's vocabulary, cadence, and opinions. Cut filler, not voice.
- Prefer active voice and concrete specifics over abstraction.
- Every sentence should earn its place.
- Protect edge, opinion, and character — don't sand the writing down to neutral.

## Patterns to remove

- Throat-clearing openers ("Here's the thing", "Let's dive in")
- Binary contrasts ("It's not X. It's Y.")
- Faux-insight setups ("What nobody tells you...")
- Colon reveals used for fake drama ("The best part: it just works")
- Dramatic fragments ("That's it. That's the whole thing.")
- Importance puffery ("marks a pivotal moment", "a game-changer")
- Weasel attribution ("experts agree", "studies show" with no source)
- Synonym cycling / repetitive rewording of the same point
- Fake-profound or summary-recap endings
- Robotic, uniformly-paced sentence rhythm

## Workflow

1. Read the full draft; identify the core point and the voice signals worth keeping.
2. Make targeted cuts and rewrites — don't rewrite wholesale.
3. Check the result: does it still sound like the author, and is every sentence necessary?
4. Return the edited version with a brief "What changed" summary (edit mode) or the pattern list (detect mode).
