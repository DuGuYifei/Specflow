# ADR-002: UI assets embedded in the compiled binary

## Status

Accepted

## Context

The goal is a single `specflow` binary with no external dependencies. The UI is built by Vite into `packages/ui/dist/`. The server must be able to serve these files both during development and from the compiled binary.

## Decision

Use `import.meta.glob` to embed UI assets at bundle time:

```ts
// packages/server/src/static-ui.ts
const files = import.meta.glob<string>("../../ui/dist/**/*", {
  as: "file",
  eager: true,
});
```

During `bun build --compile`, the Bun bundler resolves the glob, reads all matched files, and embeds them as virtual assets inside the binary. At runtime, `Bun.file(embeddedPath)` serves them directly from memory.

Build order is enforced by the root `build` script:

```
build:ui  →  Vite produces packages/ui/dist/
build:bin →  bun build --compile embeds dist/ into ./specflow
```

In development (`bun run dev`), `serveStaticUi` is never invoked — the Vite dev server proxy handles all UI requests — so the empty glob (no dist/ yet) is harmless.

## Consequences

- `packages/ui/dist/` is a build artifact and must exist before `build:bin` runs.
- Changing UI files requires re-running `build` to update the binary.
- The `import.meta.glob` API is a Bun bundler transform, not a standard runtime API. A `glob.d.ts` type declaration is included in the server package for TypeScript compatibility.
- SPA client-side routes are handled by falling back to `index.html` for any unmatched path.
