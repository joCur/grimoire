import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = path.resolve(import.meta.dirname, "..");

// Build id burned into the bundle (issue #24). The Dockerfile's build stage
// passes the commit sha as GRIMOIRE_BUILD; a plain `bun run build` has none
// and gets "dev", which switches the version handshake off (see
// src/lib/build-id.ts).
const buildId = process.env.GRIMOIRE_BUILD?.trim() || "dev";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __GRIMOIRE_BUILD__: JSON.stringify(buildId),
  },
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
