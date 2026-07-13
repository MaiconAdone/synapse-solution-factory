# VS Code Chat Integration

AdoneX contributes the native VS Code Chat participant `@adonex`.

## Commands

- `/plan`: local technical plan grounded in selected workspace files.
- `/review`: local code and architecture review.
- `/roadmap`: local Synapse roadmap.
- `/implement`: prepares a governed implementation task.
- `/test`: prepares governed test execution.
- `/agent`: prepares a governed Synapse agent task.
- `/mcp`: prepares a governed Synapse MCP tool task.
- `/projeto` or `/project`: starts the Synapse solution-project briefing in
  the VS Code chat.

Requests without a slash command use repository-aware local engineering chat.

## Synapse Solution Factory In Chat

Project creation and solution implementation do not require a browser. When the
user asks `@adonex` to create or implement a Synapse ML/AI/RAG/chatbot/agent
solution, the participant checks the mandatory briefing fields before opening a
governed task:

- project goal;
- business problem;
- requested universe;
- success metric or acceptance criteria;
- available data or knowledge sources;
- risk level.

If any field is missing, `@adonex` asks direct questions in the chat and stops
there. After the briefing is complete, the implementation path must consult the
BusinessSolutionAnalyzer, write or update `config/business_solution_analysis.json`
and `docs/briefings/business_solution_analysis.md`, then follow tests, evals,
governance and local-first cost policy.

## Local-First Routing

Read-only Chat operations always use Ollama. Automatic Synapse detection upgrades
the prompt to Synapse Mode while retaining local execution. The Chat participant
does not silently fall back to OpenAI; a local provider failure is shown to the
user with a shortcut to the Ollama settings.

Only bounded context is used:

- task-ranked workspace files;
- up to eight safe file references;
- up to two recent user turns, truncated to 800 characters each;
- attached workspace paths, without directly copying attachment content.

Sensitive paths such as `.env`, credentials, private keys, and secret folders
are excluded. Prompt text is redacted before it reaches a provider.

## Governance Boundary

The Chat handler never applies a patch or executes a terminal command.
Side-effecting commands show a deterministic plan and a button that opens the
existing AdoneX sidebar workflow. The sidebar then preserves the full lifecycle:

1. register the task under `.adonex/tasks`;
2. request model execution approval;
3. generate and preview the diff;
4. request write approval;
5. request terminal approval;
6. capture test output and offer a governed correction;
7. produce the final summary and commit suggestion.

This keeps native Chat convenient without creating a second execution path.
