# Conventions

- TypeScript strict mode across all packages.
- ESM by default.
- Explicit package boundaries; avoid hidden cross-package imports.
- Domain types should remain readable and product-centric.
- Avoid premature abstraction.
- Use AI-readable comments for non-obvious logic.
- CLI commands should be deterministic.
- Server routes should be small and typed.
- Web UI should keep product concepts visible and avoid premature state complexity.

## Toolchain Management

- This project uses mise for local Node.js and pnpm toolchain management.
- Toolchain versions are defined in `.mise.toml`.
- Node.js must be `24.15.0`.
- pnpm must be `10.33.2`.
- `package.json` must mirror pnpm through `packageManager` and Node.js through `engines.node`.
- Version changes must happen in a dedicated PR.
- This ensures deterministic execution across local development, CI, and AI agents such as Codex.
