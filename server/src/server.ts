// Grimoire server — Hono app.
// Runs on Bun (bun run src/server.ts). No Bun-only runtime APIs are used
// (DECISIONS #5/#7): Bun picks up the default { port, fetch } export below;
// on Node >= 20 the same app runs via @hono/node-server instead:
//   import { serve } from "@hono/node-server"; serve({ fetch: app.fetch, port: PORT });
//
// Planned API — the living checklist (conventions: /README.md). Tick an
// endpoint here when it is implemented:
//
//   [x] GET  /api/campaigns                    campaign list (directories)
//   [x] GET  /api/:campaign/tree               scenes/npcs/locations/sessions as a tree (frontmatter parsed)
//   [x] GET  /api/:campaign/file?path=...      one file (raw + parsed + mtime)
//   [x] PATCH /api/:campaign/frontmatter       { path, mtimeMs, patch } — only if
//                                              mtimeMs is unchanged, otherwise 409
//   [x] POST /api/:campaign/session/start      creates sessions/<today>.md
//   [x] POST /api/:campaign/session/end        sets `ended`
//   [x] POST /api/:campaign/log                { text, sceneId? } -> append with timestamp
//   [x] POST /api/:campaign/inbox              { text } -> append to inbox.md
//   [x] GET  /api/:campaign/search?q=...       { results } — fuzzy search (Fuse.js, in-memory,
//                                              scenes/npcs/locations/chapters, max 20 results)
//   [x] GET  /api/:campaign/version            { version } — bumped by the file watcher on md
//                                              changes; the app polls it and refetches on change
//                                              (SSE considered and deferred, DECISIONS #9)
//   [x] POST /api/:campaign/generate           { chapter, sourceText, newChapter? } ->
//                                              GenerateResult (review preview; writes
//                                              NOTHING). newChapter allows a chapter
//                                              directory that does not exist yet.
//   [x] POST /api/:campaign/generate/apply     { scenes, stubs, chapter?, chapterTitle? }
//                                              -> { written } (drafts on disk; 409
//                                              { conflicts } when any target exists —
//                                              nothing partially written). chapter +
//                                              chapterTitle create <chapter>/_chapter.md
//                                              when missing, in the same batch.
//   [x] POST /api/:campaign/review/seen        { path, line } -> add the line's short hash
//                                              to the session's `reviewed` list (idempotent)
//   [x] POST /api/:campaign/review/thread      { chapter, text } -> append `- [ ] text` under
//                                              ## Offene Fäden of <chapter>/_chapter.md
//   [x] POST /api/:campaign/review/npc-stub    { id, name?, note? } -> create npcs/<id>.md
//                                              (status: unknown); 409 when the slug exists
//   [x] POST /api/:campaign/review/inbox-done  { line } -> rewrite the inbox line to `- [x] …`
//                                              (documented append-only exception)
//
// Validation after generate: frontmatter parseable, status==draft, references
// exist or ship as stubs, only known callouts. Errors -> correction turn to
// the LLM (max 2), see generator/README.md; exhausted retries -> 422.
//
// Everything that is NOT under /api is served from the frontend build
// (app/dist) with an index.html fallback for client-side routes — see
// ./static-files (production only; in dev Vite does this and proxies /api).
//
// The LLM provider (./llm-provider) is created lazily per generate request
// (./generator obtainProvider) — instantiating it at boot would require an
// API key even for the read-only API. Unconfigured provider -> 503 with the
// factory's message ("ANTHROPIC_API_KEY fehlt").

import { existsSync } from "node:fs";
import { Hono } from "hono";
import { getAppDistDir, getCampaignRoot, PORT } from "./config";
import { api } from "./routes/api";
import { mountStaticApp } from "./static-files";
import { startWatcher } from "./watcher";

export const app = new Hono();
app.route("/api", api);

// The file watcher (issue #8) and the static SPA routes (issue #13) are wired
// up ONLY when this file is the process entrypoint — importing the app for
// in-process tests must stay free of side effects (no live fs watcher keeping
// `bun test` alive, and no catch-all route swallowing 404 assertions; the
// static tests mount their own app via mountStaticApp).
// import.meta.main is supported by Bun and Node >= 24; a Node entrypoint
// that serves the app via @hono/node-server (see above) should do the same
// two calls itself.
if (import.meta.main) {
  console.log(`Grimoire server — campaigns: ${getCampaignRoot()}, port: ${PORT}`);
  startWatcher();

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

// Bun serves this automatically when the file is the entrypoint; the app
// object itself stays runtime-neutral (see Node alternative above).
export default {
  port: PORT,
  fetch: app.fetch,
};
