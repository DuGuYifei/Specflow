# ADR 0002: Application framework selection

## Status
Accepted

## Decision

We chose:

- `apps/cli` as the developer and agent command entry point
- `commander` for CLI parsing
- Fastify for the server boundary
- Vite + React for the web app baseline
- `@xyflow/react` for node-based workflow visualization

Phase 0 scope is intentionally limited to skeleton implementations and static placeholders.

## Consequences

- fast bootstrapping for CLI/server/web surfaces
- clear runway for future runtime and UI graph capabilities
- avoids premature implementation of orchestration, persistence, or third-party agent integrations
