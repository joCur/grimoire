// Grimoire server — assembles the Hono app: it mounts the API under /api and,
// in production, serves the frontend build (app/dist) with an index.html
// fallback for client-side routes (./static-files; in dev Vite serves the app
// and proxies /api). The API itself is documented AT ITS ROUTES — one module
// per resource (./routes/<resource>.ts), assembled in ./routes/api.ts, one
// comment per endpoint, no second list.
//
// Runs on Bun (bun run src/server.ts). The one Bun-only option is the idle
// timeout of the default export (decisions/stack): Bun picks up the default
// { port, idleTimeout, fetch } export below;
// on Node >= 20 the same app runs via @hono/node-server instead:
//   import { serve } from "@hono/node-server"; serve({ fetch: app.fetch, port: PORT });

import { existsSync } from "node:fs";
import { Hono } from "hono";
import { getAppDistDir, getDbFile, PORT } from "./config";
import { api } from "./routes/api";
import { mountStaticApp } from "./static-files";
import { initStore } from "./store/handle";
import { purgeTrash } from "./store/trash";

/** How often the running server purges the trash, in milliseconds. */
const TRASH_PURGE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Remove what has been in the trash for longer than its retention
 * (decisions/trash) and say so when there was anything. A failure is logged,
 * not thrown: the next run tries again.
 */
async function purgeExpiredTrash(): Promise<void> {
  try {
    const removed = await purgeTrash();
    if (removed > 0) console.log(`Trash: ${removed} row(s) past their retention removed.`);
  } catch (error) {
    console.error("Trash purge failed:", error);
  }
}

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
  if (info !== undefined && info.interruptedReplies > 0) {
    console.log(
      `${info.interruptedReplies} scene chat repl(ies) were being written at the last shutdown — ` +
        "marked as failed (retry them in the chat).",
    );
  }

  // The trash is purged at boot and then every hour, so a row leaves it
  // once its retention is over whether or not the server was restarted.
  await purgeExpiredTrash();
  setInterval(() => void purgeExpiredTrash(), TRASH_PURGE_INTERVAL_MS);

  // Production: serve the Vite build from the same process (deployment is one
  // container, decisions/stack). In dev app/dist does not exist — Vite serves the
  // app and proxies /api — so this stays inactive and the server is API-only.
  const dist = getAppDistDir();
  if (existsSync(dist)) {
    mountStaticApp(app, dist);
    console.log(`Serving app build from ${dist}`);
  } else {
    console.log(`No app build at ${dist} — API only (dev: use the Vite dev server)`);
  }
}

/**
 * Seconds a connection may stay silent before the server closes it — Bun's
 * own default is ten, too short for a quick-ideas question, which waits on
 * the model inside its request (../quick-ideas-reply.ts). 255 is the most Bun
 * allows; the reply's own timeout stays below it. A registered Bun-only
 * option (decisions/stack): Node's server keeps a request open for five
 * minutes by default, longer than the reply waits.
 */
const IDLE_TIMEOUT_SECONDS = 255;

// Bun serves this automatically when this file is the entrypoint; the app
// object itself stays runtime-neutral (see Node alternative above).
export default {
  port: PORT,
  idleTimeout: IDLE_TIMEOUT_SECONDS,
  fetch: app.fetch,
};
