# ADR-001: Monorepo package boundaries

## Status

Accepted

## Context

Specflow needs to support multiple entry points (browser UI server today, headless CLI later) and multiple agent backends (Codex, Claude Code, potentially others). The core workflow logic must remain independent of any specific entry point or agent provider.

## Decision

Use a Bun workspace monorepo with the following package boundaries:

```
packages/
  shared/       — constants and types shared across all packages
  workflow/     — core graph model (nodes, edges, workflow)
  agent-proxy/  — subprocess wrapper for external agent CLIs
  bridge/       — stateful runtime that orchestrates workflow + agent calls
  server/       — HTTP server; serves the UI and exposes an API; calls bridge
  ui/           — React canvas app; built by Vite; embedded into the binary
  cli/          — binary entry point; starts the server
```

Call direction (one-way only):

```
cli → server → bridge → workflow
                      → agent-proxy
ui  → server (HTTP)
```

## Consequences

- Adding a new entry point (e.g. `--headless`) means creating a new package that calls `bridge` directly, not server.
- The `server` package is intentionally not the "core" — it is just one consumer of `bridge`.
- `ui` is decoupled from `bridge`; all communication goes through the HTTP API exposed by `server`.
- `workflow` and `agent-proxy` have no knowledge of HTTP, sessions, or UI.
