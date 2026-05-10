import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { DEV_UI_PORT } from "../shared/src/constants.ts";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: DEV_UI_PORT,
    hmr: {
      host: "127.0.0.1",
      clientPort: DEV_UI_PORT,
    },
  },
});
