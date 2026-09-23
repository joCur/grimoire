// Grimoire server — assembles the Hono app: it mounts the API under /api and,
// in production, serves the frontend build (app/dist) with an index.html
// fallback for client-side routes (./static-files; in dev Vite serves the app
// and proxies /api). The API itself is documented AT ITS ROUTES
// (./routes/api) — one comment per endpoint, no second list.
//
// Runs on Bun (bun run src/server.ts). No Bun-only runtime APIs are used
// (DECISIONS #5/#7): Bun picks up the default { port, fetch } export below;
// on Node >= 20 the same app runs via @hono/node-server instead:
//   import { serve } from "@hono/node-server"; serve({ fetch: app.fetch, port: PORT });

import { existsSync } from "node:fs";
import { Hono } from "hono";
import { getAppDistDir, getDbFile, PORT } from "./config";
import { api } from "./routes/api";
import { mountStaticApp } from "./static-files";
import { initStore } from "./store/handle";

export const app = new Hono();
app.route("/api", api);

// The database boot and the static SPA routes are
// wired up ONLY when this file is the process entrypoint — importing the app
// for in-process tests must stay free of side effects (no database file
// created next to the repo, and no catch-all route swallowing 404 assertions;
// the static tests mount their own app via mountStaticApp).
// import.meta.main is supported by Bun and Node >= 24; a Node entrypoint
// that serves the app via @hono/node-server (see above) should do the same
// two calls itself.
if (import.meta.main) {
  console.log(`Grimoire server — database: ${getDbFile()}, port: ${PORT}`);
  // Opens the database and applies the schema migrations — see
  // store/handle.ts. NOTHING is imported: a fresh instance
  // starts empty. Awaited before the first request so a boot that cannot open
  // its database fails loudly instead of on the first query.
  const store = await initStore();
  void store;
  const info = (await import("./store/handle")).storeInfo();
  console.log(`Database ready (${info?.backend ?? "unknown backend"}).`);
  // Jobs are rows, so a restart keeps a finished generation — but a run that
  // was in flight died with the previous process and is reported as failed.
  // Say so, it explains the app's message.
  if (info !== undefined && info.interruptedJobs > 0) {
    console.log(
      `${info.interruptedJobs} generate job(s) were running at the last shutdown — ` +
        "marked as failed (restart the run).",
    );
  }

  // Production: serve the Vite build from the same process (deployment is one
  // container, DECISIONS #5). In dev app/dist does not exist — Vite serves the
  // app and proxies /api — so this stays inactive and the server is API-only.
  const dist = getAppDistDir();
  if (existsSync(dist)) {
    mountStaticApp(app, dist);
    console.log(`Serving app build from ${dist}`);
  } else {
    console.log(`No app build at ${dist} — API only (dev: use the Vite dev server)`);
  }
}

// Bun serves this automatically when this file is the entrypoint; the app
// object itself stays runtime-neutral (see Node alternative above).
export default {
  port: PORT,
  fetch: app.fetch,
};
