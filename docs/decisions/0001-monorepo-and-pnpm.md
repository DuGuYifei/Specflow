# ADR 0001: Monorepo and pnpm workspace foundation

## Status
Accepted

## Decision

We chose:

- a monorepo layout for coordinated evolution of CLI/server/web and shared packages
- pnpm workspaces for efficient dependency and script orchestration
- TypeScript for shared typing across all boundaries
- `.specflow` as a repository-level project knowledge layer
- `mise` for local toolchain management
- exact version locking sourced from `.mise.toml` for deterministic human/AI/CI execution

## Consequences

- easier cross-app refactoring with explicit package contracts
- reproducible environment across local development and CI
- stronger onboarding ergonomics for humans and AI agents
