# Repository Guide for AI Agents

## Start here

1. `README.md` for project framing and setup.
2. `docs/product/vision.md` for product intent.
3. `docs/architecture/overview.md` for boundaries.
4. `.specflow/*` for repository knowledge and conventions.

## Code locations

- Product/domain types: `packages/core`
- Workflow runtime placeholder: `packages/workflow`
- Agent abstraction placeholder: `packages/agents`
- `.specflow` helper utilities: `packages/specflow-kit`
- CLI entrypoint: `apps/cli`
- Server entrypoint: `apps/server`
- Web UI entrypoint: `apps/web`
- Repository knowledge: `.specflow/`

## Rules for future AI changes

- Keep boundaries explicit; avoid hidden cross-package imports.
- Prefer readable and deterministic behavior over abstraction-heavy code.
- Add comments for non-obvious logic and future-phase TODOs only when helpful.
- Keep command/server behavior typed and small.

## Toolchain rules

- Use Node.js and pnpm versions from `.mise.toml`.
- Use `mise` for local execution.
- Do not change toolchain versions unless explicitly requested.

## Phase 0 boundaries

- Do not implement real agents.
- Do not implement production workflow orchestration.
- Do not add database/auth/persistence.
- Keep graph UI static and explanatory.
