# Architecture

## Package layout

```
packages/
  shared/       — constants and types shared across all packages
  workflow/     — core graph model: Workflow, WorkflowNode, WorkflowEdge
  agent-proxy/  — subprocess wrapper for external agent CLIs (Codex, Claude Code)
  bridge/       — stateful runtime; orchestrates workflow execution and agent calls
  server/       — HTTP server; serves the UI and exposes the API; calls bridge
  ui/           — React canvas app built by Vite; embedded into the binary at build time
  cli/          — binary entry point (`specflow`); starts the server
```

## Call direction

Dependencies flow one way only:

```
cli → server → bridge → workflow
                      → agent-proxy
ui  → server (HTTP API)
```

No package may import from a package above it in this graph.

## Entry points

| Mode | Package | Status |
|------|---------|--------|
| Browser UI | `cli` → `server` → `bridge` | In progress |
| Headless | `cli` → `bridge` (direct) | Planned — `--headless` flag |

`server` is not the core — it is one consumer of `bridge`. A future headless mode calls `bridge` directly and does not involve `server`.

## Binary distribution

`bun build --compile` produces a single `specflow` executable. The UI dist (`packages/ui/dist/`) is embedded at bundle time via `import.meta.glob` in `packages/server/src/static-ui.ts`. Build order:

```
bun run build:ui   →  Vite produces packages/ui/dist/
bun run build:bin  →  bun build --compile embeds dist/ into ./specflow
bun run build      →  runs both in sequence
```

In development (`bun run dev`), the server proxies all UI requests to Vite's dev server — no dist needed.

## Architectural decisions

Detailed rationale for key decisions is in [`docs/decisions/`](../../docs/decisions/).
