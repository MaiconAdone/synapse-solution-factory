# Architecture

AdoneX is split into a VS Code adapter layer and testable engineering services.

## Build And Validation

- TypeScript emits test artifacts for local validation.
- esbuild creates the production CommonJS bundle at `dist/extension.js`.
- The VS Code API remains external and is supplied by the Extension Host.
- `npm test` runs unit and contract tests.
- `npm run test:extension` activates AdoneX in an isolated installed VS Code.
- `npm run check` runs both validation layers.

1. `AdoneXPanel` owns the webview state and approval workflow.
2. `AgentOrchestrator` creates a deterministic plan, selects context, routes the
   request, and parses implementation proposals.
3. `WorkspaceContext` reads only bounded text files and redacts detected secrets.
4. `OpenAiClient` and `OllamaClient` implement provider-specific transport.
5. `CostGuard` blocks OpenAI requests that exceed configured budgets.
6. `PatchEngine` previews and applies complete-file proposals after approval.
7. `CommandRunner` blocks dangerous commands and uses the integrated terminal.
8. `AdoneXMcpRegistry` keeps future MCP transports independent from tool logic.
9. `TaskStore` persists the complete lifecycle under `.adonex/tasks`.
10. Captured test results can trigger a fresh-context correction proposal, which
    still passes through diff preview and write approval.

The extension never treats generated text as proof that an operation occurred.
Only VS Code adapters may report confirmed writes or command launches.
