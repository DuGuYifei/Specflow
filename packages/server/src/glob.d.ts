// import.meta.glob is a Bun bundler transform (resolved at bun build time).
// Under `bun run` it is undefined — static-ui.ts guards against this with try/catch.
declare interface ImportMeta {
  glob<T = unknown>(
    pattern: string,
    options?: { as?: string; eager?: boolean },
  ): Record<string, T>;
}
