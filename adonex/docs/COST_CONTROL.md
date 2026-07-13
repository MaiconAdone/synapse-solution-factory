# Cost Control

AdoneX estimates tokens using a conservative character-based approximation.
OpenAI estimates use configurable daily and monthly limits. Usage is recorded in
`.adonex/usage.json`.

- Economic: local Ollama in the MVP
- Balanced: configured intermediate OpenAI model
- Strong: configured strong OpenAI model
- Local: Ollama only
- Native `@adonex` Chat: Ollama only, with no automatic cloud fallback

The `AdoneX: Reset Cost Usage` command clears local usage records. Local Ollama
calls are not assigned an API cost.
