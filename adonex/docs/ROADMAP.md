# Roadmap

## Next

- OpenAI prompt caching metrics and exact provider usage pricing
- Multi-root workspace support
- Signed MCP server transport and permission manifests
- Ruflo workflow execution and fleet telemetry
- Automated extension-host integration tests
- Marketplace packaging, telemetry consent, and release signing

## Shipped

- Structured partial patches instead of complete-file proposals: the Tool
  Loop's `edit_file` applies one surgical `ProposedPatchOperation` at a time,
  and `patch/textDiff.ts` produces a real unified diff (context lines,
  correct hunk header) instead of dumping the whole file as removed+added.
- Terminal output capture: already real (`execution/capturedCommand.ts`, used
  everywhere) plus cancellable via `AbortSignal` — the Parar button now kills
  an in-flight command instead of only stopping the next one. Deliberately
  not migrated to VS Code Task API/pty: AdoneX commands are always
  non-interactive validation, which doesn't need pty semantics.
- Semantic context index with local embeddings: already used by
  `WorkspaceContext.collect()`/`/search`; added `warmIndex()` and the
  `AdoneX: Rebuild Semantic Index` command to build the cache ahead of the
  first task instead of paying that cost inline.
- Streaming response rendering: the main chat panel now streams the answer
  incrementally (`llm/ollamaClient.ts` `onChunk`), then swaps in the final
  sanitized text. Scoped to the webview panel only — the VS Code Chat
  participant (`@adonex`) can't safely combine incremental `stream.markdown()`
  with the post-hoc hallucination guard, so it still answers in one shot.
