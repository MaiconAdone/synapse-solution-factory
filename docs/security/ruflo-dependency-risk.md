# Ruflo dependency risk

The Ruflo runtime is pinned to `3.10.43` and installed only as a development
dependency. Production dependency checks use `npm audit --omit=dev
--omit=optional`; the application runtime does not expose Ruflo's CLI as a
network service.

As of June 12, 2026, Ruflo's published transitive dependency tree still causes
the full development audit to report vulnerabilities, including advisories in
agent tooling, ONNX/protobuf packages, and optional native integrations. A
local override cannot safely remove all findings because some required fixed
versions are not compatible with the published Ruflo graph.

Operational controls:

- Run Ruflo locally or through governed stdio/MCP execution only.
- Do not expose its CLI or debug endpoints to untrusted networks.
- Accept models, embeddings, MCP servers, and workflow definitions only from
  trusted sources.
- Keep Ruflo pinned and review the full `npm audit` report before upgrades.
- Block production release if `npm audit --omit=dev --omit=optional` reports a
  vulnerability.

This is an upstream residual risk, not a clean audit result. Re-evaluate it
whenever Ruflo publishes a dependency refresh.
