import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: "src/index.tsx",
      formats: ["es"],
      fileName: "index"
    },
    rollupOptions: {
      external: ["@xyflow/react", "react", "react-dom", "react/jsx-runtime"]
    }
  }
});
