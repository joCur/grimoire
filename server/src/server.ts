// Grimoire server — Hono app.
// Runs on Bun (bun run src/server.ts). No Bun-only runtime APIs are used
// (DECISIONS #5/#7): Bun picks up the default { port, fetch } export below;
// on Node >= 20 the same app runs via @hono/node-server instead:
//   import { serve } from "@hono/node-server"; serve({ fetch: app.fetch, port: PORT });
//
// Planned API — the living checklist (conventions: /README.md). Tick an
// endpoint here when it is implemented:
//
//   [x] GET  /api/campaigns                    campaign list (directories + lastSession +
//                                              name/description from _campaign.md)
//   [x] GET  /api/:campaign/tree               scenes/npcs/locations/sessions as a tree (frontmatter parsed)
//   [x] GET  /api/:campaign/file?path=...      one file (raw + parsed + mtime)
//   [x] PATCH /api/:campaign/frontmatter       { path, mtimeMs, patch } — only if
//                                              mtimeMs is unchanged, otherwise 409
//   [x] PUT  /api/:campaign/file               { path, mtimeMs, body } — write the markdown
//                                              BODY of an existing file (issue #15); the
//                                              frontmatter block is kept byte-identically,
//                                              same mtime guard as PATCH above (409)
//   [x] POST /api/:campaign/campaign-meta      { name, description? } -> create
//                                              _campaign.md (id = directory name);
//                                              409 when it exists — editing it is
//                                              PATCH /frontmatter's job (issue #34)
//   [x] GET  /api/:campaign/session            the ACTIVE session (issue #40): the last
//                                              STARTED session file that is not ended —
//                                              today's OR an older one, so a session past
//                                              midnight stays active. Same shape as
//                                              GET /file plus startedMs/endedMs/pausedMs/
//                                              pausedSinceMs (the server's epoch reading of
//                                              the zone-less timestamps and of the pause
//                                              intervals — the client must never guess the
//                                              timezone); 404 when none runs.
//                                              ?includeEnded=1 -> the last STARTED session
//                                              regardless of `ended`: the file the REVIEW
//                                              harvests (a session ended past midnight
//                                              lives in yesterday's file, so the client
//                                              must not guess it either); 404 only when the
//                                              campaign has no session file at all
//   [x] POST /api/:campaign/session/start      creates sessions/<today>.md; idempotent while
//                                              today's session is the running one.
//                                              409 { code: "session_running", path } when an
//                                              OLDER session is still open, 409 { code:
//                                              "session_ended", path } when today's is
//                                              already ended (the app offers /resume)
//   [x] POST /api/:campaign/session/resume     removes `ended` from the last started session
//                                              — the explicit undo of an accidental
//                                              "beenden"; 404 without any session, 409 when
//                                              that session is still running
//   [x] POST /api/:campaign/session/end        sets `ended` in the ACTIVE session; idempotent
//                                              (falls back to the last started session) and
//                                              closes an open pause interval
//   [x] POST /api/:campaign/session/pause      opens a `pauses` interval + `— Pause` log line
//                                              — the clock really stops (issue #40 AK8);
//                                              idempotent, 404 when nothing runs
//   [x] POST /api/:campaign/session/continue   closes that interval + `— Weiter`; idempotent.
//                                              Distinct from /session/resume, which re-opens
//                                              an ENDED session
//   [x] POST /api/:campaign/session/discard    deletes the ACTIVE session's file — allowed
//                                              only while it is EMPTY (no log entry, no
//                                              scenes_played); 409 { code:
//                                              "session_not_empty" } otherwise, 404 when
//                                              nothing is running
//   [x] POST /api/:campaign/log                { text, sceneId? } -> append with timestamp
//                                              to the ACTIVE session (issue #40); STRICT —
//                                              404 when no session is running
//   [x] POST /api/:campaign/inbox              { text } -> append to inbox.md
//   [x] GET  /api/:campaign/search?q=...       { results } — fuzzy search (Fuse.js, in-memory,
//                                              scenes/npcs/locations/chapters/_campaign.md,
//                                              max 20 results)
//   [x] GET  /api/:campaign/version            { version, build } — version is bumped by the
//                                              file watcher on md changes; the app polls it and
//                                              refetches on change (SSE considered and deferred,
//                                              DECISIONS #9). build is this server's build id
//                                              (GRIMOIRE_BUILD, "dev" outside an image) — issue
//                                              #24: when it differs from the app's own build id
//                                              the app shows a reload banner. Every /api
//                                              response also carries it as x-grimoire-build.
//   [x] POST /api/:campaign/generate           { chapter, sourceText, newChapter? } ->
//                                              202 { jobId } — starts a background job
//                                              (issue #19; writes NOTHING). newChapter
//                                              allows a chapter directory that does not
//                                              exist yet. 409 { jobId } while one runs.
//   [x] POST /api/:campaign/generate/npc       { sourceText, id? } -> 202 { jobId } —
//                                              one NPC file draft from source material
//                                              (issue #21), same job model and same
//                                              pipeline mechanics as the scene run;
//                                              409 { jobId } while ANY generator job
//                                              runs, 409 { path } when the pinned id's
//                                              file exists. Writes NOTHING.
//   [x] GET  /api/:campaign/generate/job       GenerateJob (running/done/failed incl.
//                                              kind, result/npcResult, error body and
//                                              draftEdits), 404 when there is none
//   [x] DELETE /api/:campaign/generate/job     discard the job ("Verwerfen")
//   [x] PUT  /api/:campaign/generate/job/drafts { path, markdown } -> keep one review
//                                              edit in the job (400 unknown path)
//   [x] POST /api/:campaign/generate/apply     { scenes?, stubs?, npc?, chapter?,
//                                              chapterTitle?, jobId? } -> { written }
//                                              (drafts on disk; 409 { conflicts } when any
//                                              target exists — nothing partially written).
//                                              chapter + chapterTitle create
//                                              <chapter>/_chapter.md when missing, in the
//                                              same batch; `npc` is the NPC run's single
//                                              draft (issue #21); jobId discards that job
//                                              after a successful write.
//   [x] POST /api/:campaign/rename             { kind, oldId, newId, dryRun? } ->
//                                              { renamed: { from, to }, changed } —
//                                              renames npcs/locations/scenes (file) or a
//                                              chapter (DIRECTORY) and patches every
//                                              reference site: frontmatter npcs/location/
//                                              chapter, session scenes_played, `## Beziehungen`
//                                              lines, log scene markers. Prose is NOT touched.
//                                              Plan-then-execute: 400/404/409 { path } write
//                                              nothing; dryRun returns the plan only (issue #30)
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
// the LLM (LLM_CORRECTION_TURNS, default 1, max 2 — issue #19), see
// generator/README.md; exhausted retries -> 422. A reply the model TRUNCATED
// (finish_reason/stop_reason) skips the correction turns and answers 422
// right away (issue #18). Every generator 422 carries the last raw reply
// (`rawReply`, capped) and the run's `usage` — since issue #19 inside the
// job's `error` body instead of as the POST's response.
//
// Generate jobs live in memory only (./generate-jobs): a restart loses them,
// deliberately — the campaign files stay the only truth on disk. The app
// reports a vanished job instead of waiting forever.
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
