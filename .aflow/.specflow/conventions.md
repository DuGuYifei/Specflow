# Conventions

## Language and runtime

- TypeScript everywhere. No JavaScript source files.
- Bun as the runtime and bundler. Version is pinned in `.mise.toml`.
- All packages set `"type": "module"` and `"moduleResolution": "Bundler"`.

## Package structure

- Each package exports only from `src/index.ts`. No deep imports across package boundaries.
- Internal modules within a package are not re-exported unless explicitly needed by consumers.
- Shared constants live in `@specflow/shared`. No package defines its own duplicate constants.

## Naming

- Files: `kebab-case.ts`
- Types and interfaces: `PascalCase`
- Functions and variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`

## Code style

- No comments explaining what code does — names should be self-explanatory.
- Comments only for non-obvious constraints, invariants, or workarounds.
- No error handling for impossible scenarios. Validate only at system boundaries.
- No feature flags or backwards-compatibility shims — change the code directly.

## Workflow domain

- `WorkflowNode` and `WorkflowEdge` are discriminated unions of concrete graph types.
- `Workflow` owns the graph directly (`nodes`, `edges`). There is no separate `WorkflowGraph` wrapper.
- Nodes use `kind` as the discriminator. Agent nodes and functional nodes do not share agent-only fields.
- Edges use `kind` as the discriminator. Passthrough edges forward content unchanged; tagged-output edges bind content into prompt variables.
