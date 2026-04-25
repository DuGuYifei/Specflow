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

- Node.js: see `.mise.toml`
- pnpm: see `.mise.toml`
- Local toolchain manager: `mise`

Tool versions are locked in `.mise.toml` and mirrored in root `package.json` / CI.

## 安装 mise

```bash
curl https://mise.run | sh
```

## 可选：自动激活 mise（推荐）

如果你启用了自动激活，以后就不需要每条命令都加 `mise exec --` 前缀。

### Linux / Bash

```bash
echo 'eval "$(mise activate bash)"' >> ~/.bashrc
source ~/.bashrc
```

### macOS / Zsh（默认）

```bash
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc
source ~/.zshrc
```

## Getting started

```bash
mise install

# mise exec -- pnpm install
pnpm install

# mise exec -- pnpm lint
pnpm lint

# mise exec -- pnpm typecheck
pnpm typecheck

# mise exec -- pnpm test
pnpm test

# mise exec -- pnpm build
pnpm build
```

## Common commands

```bash
# mise exec -- pnpm --filter @specflow/cli specflow --help
pnpm --filter @specflow/cli specflow --help

# mise exec -- pnpm --filter @specflow/cli specflow doctor
pnpm --filter @specflow/cli specflow doctor

# mise exec -- pnpm --filter @specflow/server dev
pnpm --filter @specflow/server dev

# mise exec -- pnpm --filter @specflow/web build
pnpm --filter @specflow/web build
```

## Monorepo layout

- `apps/` entry points (CLI/server/web)
- `packages/` shared domain/runtime/util packages
- `docs/` architecture, product, and AI guidance
- `.specflow/` repository knowledge layer for humans and AI agents
