# Architecture

## Package layout

```
packages/
  shared/       — constants and types shared across all packages
  workflow/     — workflow definitions, graph model, prompt schemas, run schemas
  agent-proxy/  — subprocess wrapper boundary for external agent CLIs
  bridge/       — stateful runtime; orchestrates workflow execution, gate routing, and agent calls
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

## Workflow core

`workflow` owns definition-time types and pure helpers only. It does not know about HTTP,
UI state, subprocesses, or runtime orchestration.

- `WorkflowNode` is a union of concrete node types. Agent nodes own agent/session/resource
  fields. Gate nodes are functional nodes and do not inherit agent fields.
- `WorkflowEdge` is a union of passthrough and tagged-output edges. Gate branch routing uses
  `sourcePortId` to select a branch output.
- `Workflow` owns agents, sessions, nodes, and edges directly.

`bridge` owns execution-time behavior:

- `WorkflowExecutor` walks the graph, renders prompts, invokes agents, and advances branches.
- `GateEvaluator` chooses one gate branch and passes the original gate input downstream.
- `TerminalEventStore` records append-only terminal chunks for UI replay and filtering.

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

## Runtime Notes

- ACP agent runtime architecture and remaining implementation plan: [`agent-proxy-acp/runtime.md`](./agent-proxy-acp/runtime.md).
- ACP protocol coverage, capability cache, per-node overrides, MCP: [`agent-proxy-acp/protocol-coverage.md`](./agent-proxy-acp/protocol-coverage.md).
- Skills + slash command injection: [`agent-proxy-acp/skills-and-slash.md`](./agent-proxy-acp/skills-and-slash.md).
- Bridge to agent-proxy call chain: [`agent-proxy-bridge-chain.md`](./agent-proxy-bridge-chain.md).
