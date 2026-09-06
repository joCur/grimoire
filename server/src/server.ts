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
//                                              name/description from _campaign)
//   [x] GET  /api/:campaign/tree               scenes/npcs/locations/sessions as a tree (properties parsed)
//   [x] GET  /api/:campaign/file?path=...      one file (raw + parsed + rev). glossary
//                                              answers 200 with an EMPTY body when the
//                                              campaign has no terms — it is an empty
//                                              document, not a missing one (#57 review:
//                                              the 404 made a glossary the DM had just
//                                              emptied unreachable from the editor).
//                                              inbox does the same since #70 — same
//                                              reasoning, it had been left behind.
//                                              `rev` of glossary/inbox is that
//                                              DOCUMENT's own counter, not campaigns.version
//   [x] PATCH /api/:campaign/properties       { path, rev, patch } — only if
//                                              rev is unchanged, otherwise 409.
//                                              A scene's `chapter` may be SET (400 when
//                                              the chapter does not exist — a scene must
//                                              never fall out of the tree) or DELETED with
//                                              null, which drops the key and leaves the
//                                              scene's address alone
//   [x] PUT  /api/:campaign/file               { path, rev, body } — write the markdown
//                                              BODY of an existing file (issue #15); the
//                                              properties block is kept byte-identically,
//                                              same rev guard as PATCH above (409)
//   [—] POST /api/:campaign/campaign-meta      REMOVED with issue #62. It existed
//                                              for the one gap PATCH /properties
//                                              could not close: a campaign whose
//                                              `_campaign` did not exist yet had
//                                              no file and therefore no guard token
//                                              to PATCH against. Since the cutover
//                                              (#57) the import always creates a
//                                              campaign ROW, GET /file?path=
//                                              _campaign therefore always
//                                              answers 200 with a `rev`, and the
//                                              app's create branch became
//                                              unreachable (observed in #59). The
//                                              name is now written the same way
//                                              every other field is: PATCH
//                                              /properties with the row's guard
//                                              token — one write path, one 409 rule
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
//   [x] POST /api/:campaign/session/start      creates a NEW session: sessions/<id> with
//                                              an OPAQUE RANDOM id (issue #58 — "beenden" is
//                                              final, so a second evening on the same day is
//                                              simply a second session with an empty log and
//                                              a runtime at 0; nothing reads the id, order and
//                                              every label come from `started`).
//                                              Idempotent only while today's session is the
//                                              RUNNING one ("today" = the date part of its
//                                              `started`). 409 { code: "session_running",
//                                              path } when an OLDER session is still open
//                                              (there is no `session_ended` any more)
//   [x] POST /api/:campaign/session/end        sets `ended` in the ACTIVE session; idempotent
//                                              (falls back to the last started session) and
//                                              closes an open pause interval
//   [x] POST /api/:campaign/session/pause      opens a `pauses` interval + `— Pause` log line
//                                              — the clock really stops (issue #40 AK8);
//                                              idempotent, 404 when nothing runs
//   [x] POST /api/:campaign/session/continue   closes that interval + `— Weiter`; idempotent.
//                                              "Weiter" ends a PAUSE — an ended session is
//                                              never re-opened (issue #58)
//   [x] POST /api/:campaign/session/discard    deletes the ACTIVE session's file — allowed
//                                              only while it is EMPTY (no log entry, no
//                                              scenes_played); 409 { code:
//                                              "session_not_empty" } otherwise, 404 when
//                                              nothing is running
//   [x] POST /api/:campaign/log                { text, sceneId? } -> append with timestamp
//                                              to the ACTIVE session (issue #40); STRICT —
//                                              404 when no session is running, 400 when
//                                              sceneId is not a kebab slug (it is a PARSE
//                                              COLUMN of `- HH:MM (id) text`)
//   [x] POST /api/:campaign/inbox              { text } -> append to inbox
//   [x] GET  /api/:campaign/search?q=...       { results } — full-text search (FTS5, bm25,
//                                              prefix terms, diacritics folded;
//                                              scenes/npcs/locations/chapters/campaign/
//                                              GLOSSARY, max 20 results — issue #57)
//   [x] GET  /api/:campaign/glossary           { entries: [{ term, explanation }] } — the
//                                              glossary TABLE (issue #57, planning F6)
//   [x] PUT  /api/:campaign/glossary           { entries } -> { entries }; replaces the list
//   [—] GET  /api/:campaign/migration-report   REMOVED with issue #79. The markdown import
//                                              left the production path (no boot import any
//                                              more): it is the dev/E2E tool `grimoire seed`,
//                                              which prints its own report on stdout. The
//                                              `migration_report` table stays as the
//                                              importer's bookkeeping (server/src/db/)
//   [x] GET  /api/:campaign/version            { version, build } — version is
//                                              `campaigns.version`, bumped by every write in
//                                              the same transaction (the chokidar watcher is
//                                              gone with the cutover); the app polls it and
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
//                                              (drafts as rows; 409 { conflicts } when any
//                                              target exists — checked IN the insert
//                                              transaction, so nothing is ever partially
//                                              written; 422 when a draft's `id` is not an
//                                              addressable slug).
//                                              chapter + chapterTitle create
//                                              <chapter>/_chapter when missing, in the
//                                              same batch; `npc` is the NPC run's single
//                                              draft (issue #21); jobId discards that job
//                                              after a successful write.
//   [x] POST /api/:campaign/rename             { kind, oldId, newId, dryRun? } ->
//                                              { renamed: { from, to }, changed } — renames
//                                              the id of an npc/location/scene/chapter and
//                                              patches every reference site: scene npcs/
//                                              location/chapter, session scenes_played,
//                                              `## Beziehungen` lines, log scene markers,
//                                              and the search index. Prose is NOT touched.
//                                              CHANGED with the cutover (#57): `from`/`to`
//                                              are DOCUMENT paths for every kind, so a
//                                              chapter reads `<id>/_chapter` where the
//                                              file version named the bare DIRECTORY —
//                                              there is no directory to rename any more
//                                              (store/paths.ts). A display name that was
//                                              literally the old id follows the id.
//                                              Plan-then-execute: 400/404/409 { path } write
//                                              nothing; dryRun returns the plan only (issue #30).
//                                              Every answer carries `usage` — the reference
//                                              counts of GET /usage (issue #60), which is what
//                                              the dialog's German summary reads off.
//   [x] GET  /api/:campaign/usage              ?kind=<npc|location|scene|chapter>&id=<slug> ->
//                                              { kind, id, path, total, groups: [{ ref, count,
//                                              sites: [{ kind, id, title, path, count }] }] } —
//                                              where an entity is REFERENCED, as queries over
//                                              the reference tables (scene npcs/location/
//                                              chapter, INCOMING `## Beziehungen` lines,
//                                              session scenes_played, log scene markers). A
//                                              group counts ROWS, its sites are the referencing
//                                              DOCUMENTS; an entity's own outgoing relations
//                                              are not references TO it. 404 unknown campaign/
//                                              entity, 400 unknown kind/empty id (issue #60)
//   [x] POST /api/:campaign/review/seen        { path, line } -> FileResponse &
//                                              { marked } — flags the log ROW whose short
//                                              hash the line has (idempotent). marked=false
//                                              means NO row hashes to the line that was
//                                              sent: nothing was changed, and the answer
//                                              says so instead of hiding it behind a 200
//   [x] POST /api/:campaign/review/thread      { chapter, text } -> append `- [ ] text` under
//                                              ## Offene Fäden of <chapter>/_chapter
//   [x] POST /api/:campaign/review/npc-stub    { id, name?, note? } -> create npcs/<id>
//                                              (status: unknown), or answer with the entry the
//                                              id already has — idempotent since #70
//   [x] POST /api/:campaign/review/inbox-done  { line } -> rewrite the inbox line to `- [x] …`
//                                              (documented append-only exception)
//
// Validation after generate: properties parseable, status==draft, references
// exist or ship as stubs, only known callouts. Errors -> correction turn to
// the LLM (LLM_CORRECTION_TURNS, default 1, max 2 — issue #19), see
// generator/README.md; exhausted retries -> 422. A reply the model TRUNCATED
// (finish_reason/stop_reason) skips the correction turns and answers 422
// right away (issue #18). Every generator 422 carries the last raw reply
// (`rawReply`, capped) and the run's `usage` — since issue #19 inside the
// job's `error` body instead of as the POST's response.
//
// Generate jobs are ROWS since issue #23 (`generate_jobs`, ./generate-jobs):
// a finished run survives a restart whole — result, error body and review
// edits — and is still applyable afterwards. A run that was IN FLIGHT cannot
// survive (its provider call died with the process), so the boot rewrites
// every leftover `running` row into a `failed` one carrying the German
// sentence of db/job-boot.ts. The app renders that field, so an interrupted
// run says "Job neu starten" instead of spinning forever.
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
import { getAppDistDir, getDbFile, PORT } from "./config";
import { api } from "./routes/api";
import { mountStaticApp } from "./static-files";
import { initStore } from "./store/handle";

export const app = new Hono();
app.route("/api", api);

// The database boot (issue #57) and the static SPA routes (issue #13) are
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
  // store/handle.ts. NOTHING is imported (issue #79 AK6): a fresh instance
  // starts empty. Awaited before the first request so a boot that cannot open
  // its database fails loudly instead of on the first query.
  const store = await initStore();
  void store;
  const info = (await import("./store/handle")).storeInfo();
  console.log(`Database ready (${info?.backend ?? "unknown backend"}).`);
  // Issue #70: a boot that CHANGED data says so. The pass creates an empty
  // npc row for every dangling npc reference and is a no-op from the second
  // boot on (store/ref-backfill.ts).
  if (info !== undefined && info.backfilledNpcs.length > 0) {
    console.log(
      `${info.backfilledNpcs.length} referenced npc(s) had no entry and got an empty one: ` +
        info.backfilledNpcs.join(", "),
    );
  }
  // Issue #23: jobs are rows now, so a restart no longer loses a finished
  // generation — but a run that was in flight died with the old process and
  // is reported as failed. Say so, it explains the app's message.
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

// Bun serves this automatically when the file is the entrypoint; the app
// object itself stays runtime-neutral (see Node alternative above).
export default {
  port: PORT,
  fetch: app.fetch,
};
