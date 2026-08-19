import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
    fs: {
      // The dev harness imports fixture files from /examples via `?raw`,
      // and @grimoire/shared is consumed as TypeScript source — both live
      // outside app/, so allow the whole repo root.
      allow: [repoRoot],
    },
  },
});
