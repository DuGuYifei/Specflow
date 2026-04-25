import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@specflow/agent": fileURLToPath(
        new URL("./packages/agent/src/index.ts", import.meta.url)
      ),
      "@specflow/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url)
      ),
      "@specflow/local-api": fileURLToPath(
        new URL("./packages/local-api/src/index.ts", import.meta.url)
      ),
      "@specflow/shared": fileURLToPath(
        new URL("./packages/shared/src/index.ts", import.meta.url)
      ),
      "@specflow/specflow": fileURLToPath(
        new URL("./packages/specflow/src/index.ts", import.meta.url)
      ),
      "@specflow/runtime": fileURLToPath(
        new URL("./packages/runtime/src/index.ts", import.meta.url)
      ),
      "@specflow/ui": fileURLToPath(
        new URL("./packages/ui/src/index.tsx", import.meta.url)
      )
    }
  },
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
    globals: false,
    passWithNoTests: true
  }
});
