# Specflow (Phase 0)

Specflow is a **Continuous Coding** platform.

It is designed to sit before traditional CI/CD so teams can transform a ticket into a structured, AI-assisted implementation workflow before code reaches CI.

**Positioning:** `CC → CI → CD`

## Current status

This repository is in **Phase 0**: monorepo and framework foundation.

Phase 0 intentionally focuses on boundaries, conventions, and deterministic tooling. It does **not** implement production workflow orchestration, real agent execution, authentication, or persistence.

## Framework choices

- CLI: TypeScript + commander (`apps/cli`)
- Server: Fastify (`apps/server`)
- Web: Vite + React + `@xyflow/react` (`apps/web`)

## Toolchain requirements

- Node.js: `24.15.0`
- pnpm: `10.33.2`
- Local toolchain manager: `mise`

Tool versions are locked in `.mise.toml` and mirrored in root `package.json`.

## Getting started

```bash
mise install
mise exec -- pnpm install
mise exec -- pnpm lint
mise exec -- pnpm typecheck
mise exec -- pnpm test
mise exec -- pnpm build
```

## Common commands

```bash
mise exec -- pnpm --filter @specflow/cli specflow --help
mise exec -- pnpm --filter @specflow/cli specflow doctor
mise exec -- pnpm --filter @specflow/server dev
mise exec -- pnpm --filter @specflow/web build
```

## Monorepo layout

- `apps/` entry points (CLI/server/web)
- `packages/` shared domain/runtime/util packages
- `docs/` architecture, product, and AI guidance
- `.specflow/` repository knowledge layer for humans and AI agents
