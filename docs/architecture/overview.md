# Architecture Overview (Phase 0)

## Monorepo layout

- `apps/cli`: deterministic command entry point for developers and AI agents.
- `apps/server`: Fastify boundary for future workflow runtime APIs.
- `apps/web`: Vite + React UI with a static graph placeholder.
- `packages/core`: shared domain types.
- `packages/workflow`: workflow graph/runtime abstractions and validators.
- `packages/agents`: agent abstraction placeholders.
- `packages/specflow-kit`: `.specflow` read/write helpers.
- `packages/shared`: shared constants and utility helpers.
- `packages/config`: shared lint/test/format/ts config guidance.

## Package boundaries

Phase 0 keeps boundaries explicit and simple:

- domain types live in `@specflow/core`
- runtime graph abstractions live in `@specflow/workflow`
- app entry points consume package APIs instead of deep relative imports

## Application responsibilities

### CLI

Provides deterministic command scaffolding:

- `doctor`
- `spec read`
- `workflow validate`

### Server

Provides placeholder APIs:

- `GET /health`
- `GET /api/project`

### Web

Displays a static node graph for the intended flow:

`ticket → interview → plan → code draft → implementation review → repair loop → final patch`

## Future direction

- Expand workflow runtime orchestration in `packages/workflow`.
- Add production agent integrations through `packages/agents`.
- Evolve web graph into interactive workflow design and run visualization.

## Node and edge semantics

Initial node/edge types in `@specflow/core` represent product semantics:

- Node types cover ticket interpretation, planning, drafting, review, repair, and final patching.
- Edge types include control flow, data flow, and review loop semantics.
