// Grimoire server — Hono app.
// Runs on Bun (bun run src/server.ts). No Bun-only runtime APIs are used
// (DECISIONS #5/#7): Bun picks up the default { port, fetch } export below;
// on Node >= 20 the same app runs via @hono/node-server instead:
//   import { serve } from "@hono/node-server"; serve({ fetch: app.fetch, port: PORT });
//
// WHAT `path` MEANS (issue #79): an ADDRESS, not a file name — no `.md`, no
// extension at all. The complete schema is in ./store/paths.ts:
//
//   _campaign · inbox · glossary · <chapter>/_chapter ·
//   <chapter>/<scene-id> · <chapter>/<group>/<scene-id> ·
//   npcs/<id> · locations/<id> · sessions/<id>
//
// The wire vocabulary follows from that: a document's fields are
// `properties`, its optimistic-concurrency token is `rev` (the row version).
// Neither `frontmatter` nor `mtimeMs` exists above the importer any more.
//
// Planned API — the living checklist (conventions: /README.md). Tick an
// endpoint here when it is implemented:
//
// ERROR BODIES ARE LANGUAGE-FREE (issue #69). Every error a HUMAN reads carries
// a stable `code` from `@grimoire/shared/error-codes` plus the parameters its
// sentence needs; the `error` text next to it is the ENGLISH technical fallback
// (curl, logs, an unknown-code client). The app renders the sentence from its
// own catalog (app/src/i18n, keys `server.<code>`) and degrades to that text
// for a code it does not know. Codes are append-only. The full list lives in
// shared/src/error-codes.ts; per-endpoint they are noted below.
//
//   [x] GET  /api/campaigns                    campaign list (directories + lastSession +
//                                              name/description from _campaign)
//   [x] POST /api/campaigns                    { name, description? } -> 201 CampaignSummary.
//                                              THE COLD START (issue #56): since #79 a fresh
//                                              instance boots empty, so this is how the first
//                                              campaign comes into being. `id` is DERIVED from
//                                              the name with the shared slug rule
//                                              (@grimoire/shared/slug — ä→ae, ö→oe, ü→ue, ß→ss,
//                                              everything else folded, kebab-cased); a name
//                                              that yields no slug is
//                                              400 { code: "slug_empty", kind, field }, a
//                                              taken id is 409 { code: "slug_taken", kind,
//                                              id, suggestion, path }
//   [x] GET  /api/settings                     InstanceSettings — the instance's UI
//                                              language (issue #69): { locale: "de" | "en"
//                                              | null }. `null` is "never decided": the app
//                                              then follows navigator.language and writes
//                                              nothing. Campaign-INDEPENDENT on purpose —
//                                              the cold start has no campaign yet
//   [x] PUT  /api/settings                     { locale } -> InstanceSettings. Stored in the
//                                              `meta` table under `setting:locale` (no table
//                                              of its own: one user, one settings object).
//                                              `null` deletes the row; anything but de/en/
//                                              null is 400. NOT localStorage — the language
//                                              is server state (quality floor)
//   [x] POST /api/:campaign/chapters         { title, goal? } -> 201 the chapter document.
//                                              Same id derivation and same 400/409 as above;
//                                              `goal` lands under `## Ziel des Kapitels`, the
//                                              heading the pool reads its goal line from
//   [x] POST /api/:campaign/chapters/:id/active -> that chapter's document. „Aktiv" in the
//                                              pool's status regler (#115): sets `active` here and
//                                              puts the previously active chapter back to
//                                              `planned`, in ONE transaction. Idempotent,
//                                              404 for an unknown chapter, no rev guard
//   [x] POST /api/:campaign/scenes             { title, chapter } -> 201 the scene document
//                                              (type planned, status draft, empty body, no
//                                              `location`). `chapter` is REQUIRED and must
//                                              exist — 400 otherwise: a scene's chapter is
//                                              part of its address and chapters are never
//                                              created by being named (ADR #14)
//   [x] POST /api/:campaign/npcs               { name } -> 201 the npc document. An EMPTY
//                                              entry for the derived id (one a reference
//                                              created, issue #70) is FILLED rather than
//                                              collided with; an entry that holds content
//                                              answers the `slug_taken` 409; a RESERVED
//                                              id answers 409 { code: "slug_reserved" },
//                                              same shape, different sentence
//   [x] POST /api/:campaign/locations          { name } -> 201 the location document, same
//                                              rules as npcs
//   [x] GET  /api/:campaign/tree               scenes/npcs/locations/sessions as a tree (properties parsed)
//   [x] GET  /api/:campaign/file?path=...      one entry (properties + body + rev). glossary
//                                              answers 200 with an EMPTY body when the
//                                              campaign has no terms — it is an empty
//                                              document, not a missing one (#57 review:
//                                              the 404 made a glossary the DM had just
//                                              emptied unreachable from the editor).
//                                              inbox does the same since #70 — same
//                                              reasoning, it had been left behind.
//                                              `rev` of glossary/inbox is that
//                                              DOCUMENT's own counter, not campaigns.version
//   [x] PATCH /api/:campaign/properties        { path, rev, patch, locationName? } — only if rev is
//                                              unchanged, otherwise
//                                              409 { code: "rev_conflict", rev }.
//                                              A scene's `chapter` may be SET (400 when
//                                              the chapter does not exist — a scene must
//                                              never fall out of the tree), never removed
//                                              (400: a scene belongs to a chapter). A key
//                                              the entry has no field for is 400 too;
//                                              unknown keys an import brought along may
//                                              be changed or deleted with null.
//                                              `locationName` is the display name for the
//                                              Ort a scene's `location` CREATES — applied
//                                              only on insert, never a rename (#100)
//   [x] PUT  /api/:campaign/file               { path, rev, body } — write the markdown
//                                              BODY of an existing document (issue #15);
//                                              its properties are untouched (they are
//                                              PATCH /properties' job), same rev guard
//                                              as PATCH above (409 `rev_conflict`)
//   [—] POST /api/:campaign/campaign-meta      REMOVED with issue #62. It existed
//                                              for the one gap PATCH /properties
//                                              could not close: a campaign whose
//                                              `_campaign` did not exist yet had
//                                              no row and therefore no guard token
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
//   [x] POST /api/:campaign/session/start      creates a NEW session at sessions/<id>, with
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
//   [x] POST /api/:campaign/inbox              { text } -> append to the inbox list
//   [x] GET  /api/:campaign/search?q=...       { results } — full-text search (FTS5, bm25,
//                                              prefix terms, diacritics folded;
//                                              scenes/npcs/locations/chapters/campaign/
//                                              GLOSSARY, max 20 results — issue #57)
//   [x] GET  /api/:campaign/glossary           { entries: [{ term, explanation }], rev } — the
//                                              glossary TABLE (issue #57, planning F6); `rev`
//                                              is the LIST's guard token, the same one
//                                              GET /file?path=glossary hands out (issue #53)
//   [x] PUT  /api/:campaign/glossary           { entries, rev } -> { entries, rev }; replaces
//                                              the WHOLE list, so the array order IS the
//                                              stored order and reordering needs no endpoint
//                                              of its own. Stale rev -> 409
//                                              { code: "rev_conflict", rev } (issue #53)
//   [x] GET  /api/:campaign/knowledge          { entries: [{ kind, from, to, text }], rev } —
//                                              the CAMPAIGN KNOWLEDGE the generator must
//                                              apply (issue #53): kind is naming|fact|style,
//                                              a `naming` entry carries from/to, the others
//                                              `text`. Guard token: campaigns.knowledge_rev
//   [x] PUT  /api/:campaign/knowledge          { entries, rev } -> { entries, rev }; the
//                                              glossary's contract to the letter — whole
//                                              list, array order is the order, stale rev ->
//                                              409 { code: "rev_conflict", rev }. A
//                                              half-filled `naming` pair is STORED (the DM
//                                              is still typing); the prompt skips it.
//                                              Entry fields must be SINGLE LINE -> 400:
//                                              an entry becomes one bullet of the
//                                              generator prompt, and a newline would let
//                                              it open lines (headings) of its own. The
//                                              glossary keeps taking wrapped explanations
//                                              (the import makes them) and is flattened
//                                              for the prompt instead
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
//   [x] POST /api/:campaign/generate/augment  { path, sourceText?, instruction? }
//                                              -> 202 { jobId } — „Mit KI ergänzen"
//                                              (issue #36): the SAME job model and the
//                                              same pipeline, pointed at an entry that
//                                              already exists (npc/location/scene). At
//                                              least one of sourceText/instruction is
//                                              required (400 otherwise); 400 for a kind
//                                              that has no augment prompt, 404 for an
//                                              unknown entry, 409 { jobId } while ANY
//                                              generator job runs. Writes NOTHING — the
//                                              job carries an `augmentResult`: the
//                                              properties proposal per field (current +
//                                              proposed + new|changed) and the whole
//                                              current/proposed BODY. The app cuts that
//                                              into Block-Composer blocks for the review
//                                              (the block model lives there), so the
//                                              decision unit is the one the DM edits.
//   [x] POST /api/:campaign/generate/augment/apply
//                                              { path, rev, properties?, body?, jobId? }
//                                              -> the written document. The DM's
//                                              decisions: the accepted properties fields
//                                              and the body assembled from the accepted
//                                              blocks, written in ONE transaction against
//                                              `rev` — 409 { code: "rev_conflict", rev }
//                                              and nothing written when the entry moved.
//                                              FTS and `[[slug]]` references follow (it is
//                                              the ordinary write path, so the #70 rule
//                                              „Referenzieren legt an" applies as well);
//                                              `jobId` discards the job in the same
//                                              transaction. `id` and the app-managed keys
//                                              are refused (400) — an id change is
//                                              POST /rename's job, with its cascade
//   [x] POST /api/:campaign/generate/job/:id/parts/:key/retry -> 202 GenerateJob —
//           „Erneut versuchen" for ONE part of a pipelined scene run (issue
//           #102). Re-runs only that part; the outline and the finished parts
//           stay. 404 unknown job/part, 409 for a part that already runs, has
//           not run yet or is done and for a job without parts, 503 without a
//           provider.
//   [x] GET  /api/:campaign/generate/job       GenerateJob (running/done/failed incl.
//                                              kind, result/npcResult/augmentResult,
//                                              error body and draftEdits), 404 when
//                                              there is none. An `augment` job also
//                                              carries `target` — the entry's address —
//                                              from the moment it STARTS.
//                                              A finished result may carry `namingHints`
//                                              (issue #53): the SERVER's own findings that
//                                              a draft still uses a spelling a naming
//                                              convention replaces — hints for the review,
//                                              never a reason to fail or block
//                                              A job also carries its REVIEW STATE and
//                                              that state's `rev` (issue #97): the
//                                              decision per suggested entry, the dropped
//                                              scenes, the per field/block decisions of an
//                                              augment run and the parts a partial accept
//                                              already wrote (`review.written`, draft path
//                                              -> the address it landed at)
//   [x] DELETE /api/:campaign/generate/job     discard the job ("Verwerfen"). Since issue
//                                              #97 that is the OPEN REST only — parts a
//                                              partial accept wrote are entries now
//   [x] PATCH /api/:campaign/generate/job/:id/review
//                                              { rev, edits?, entries?, dropped?, fields?,
//                                              blocks? } -> the job (issue #97). Everything
//                                              MERGES, so the app sends the one thing that
//                                              changed — text debounced, decisions at once.
//                                              409 { code: "rev_conflict", rev } when
//                                              another tab decided first (nothing written);
//                                              404 without a job or for a stale :id
//   [x] POST /api/:campaign/generate/job/:id/accept
//                                              { paths?, chapter?, chapterTitle? } ->
//                                              { written, jobDeleted } (issue #97).
//                                              „Diesen übernehmen" per scene / suggested
//                                              entry; without `paths` everything still
//                                              open (accepted entries included, undecided
//                                              ones not). ONE transaction with the target
//                                              guards of the ordinary draft write, FTS and
//                                              refs follow, and the job row disappears the
//                                              moment nothing is left open. A pipelined run
//                                              that is still `running` is acceptable part by
//                                              part (issue #102 AK2); 409 only for a failed
//                                              run and for one with no finished part yet
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
//   [x] POST /api/:campaign/review/seen        { path, line } -> EntryResponse &
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
// EVERY generator call answers a JSON object whose schema
// the providers FORCE (a tool call on the Claude path, `response_format:
// json_schema` on the OpenAI path): an entry call the object that mirrors
// the stored row — `properties` per kind, `body`, `warnings` (./entry-reply)
// — and the outline step its own small one. Nothing about these endpoints
// changes with it: the drafts they carry, the 422 bodies and the review
// payloads are the same shapes.
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
// Since issue #102 a SCENE run is a PIPELINE of provider calls — an outline
// call, then one call per scene and per suggested entry, three at a time — and
// the job therefore carries PARTS with a status each (./generate-pipeline,
// ADR #10). What that changes for this list: the run stays `running` while
// parts are open and its result fills up, so a finished part is reviewable and
// acceptable before the run is over; a failed part is retryable on its own
// (POST …/parts/:key/retry); a restart fails only the parts that were in
// flight. The 422 semantics above are unchanged — a run whose EVERY part
// failed answers exactly that body. The npc and the augment run stay
// single-call runs and carry no parts at all.
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
  // Issue #100: the one-time step that turned the file era's group
  // directories into `location` references. It names EVERY scene whose
  // address moved — an old link still resolves (the app follows the
  // response's `path`), but a DM who wrote one down should see it.
  const groupMigration = info?.groupMigration;
  if (groupMigration !== undefined && groupMigration.moved.length > 0) {
    console.log(
      `${groupMigration.moved.length} scene(s) moved to the group their location names:`,
    );
    for (const move of groupMigration.moved) {
      console.log(
        `  · [${move.campaignId}] ${move.sceneId}: ` +
          `${move.from === "" ? "(chapter level)" : move.from} -> ` +
          `${move.to === "" ? "(chapter level)" : move.to}`,
      );
    }
  }
  // …and the scenes it did NOT touch: a `location` nothing can be derived
  // from stays exactly as it was, and only the DM can decide what it should
  // be. Loud on purpose — it is the one case the step cannot finish.
  if (groupMigration !== undefined && groupMigration.unresolved.length > 0) {
    console.log(
      `${groupMigration.unresolved.length} scene(s) name a location that yields no id — ` +
        `left unchanged, please set one:`,
    );
    for (const open of groupMigration.unresolved) {
      console.log(`  · [${open.campaignId}] ${open.sceneId}: "${open.location}"`);
    }
  }
  if (groupMigration !== undefined && groupMigration.createdLocations.length > 0) {
    console.log(
      `${groupMigration.createdLocations.length} location(s) referenced by a scene had no ` +
        `entry and got one: ${groupMigration.createdLocations.join(", ")}`,
    );
  }
  // Issue #115: a `chapter_id` without a chapters row made the chapter AND
  // its scenes invisible in the pool. The repair gives it a row named by its
  // own slug, so it is loud on purpose — a chapter showing up under a slug is
  // something the DM wants to go and rename.
  const chapterRepair = info?.chapterRepair;
  if (chapterRepair !== undefined && chapterRepair.created.length > 0) {
    console.log(
      `${chapterRepair.created.length} chapter(s) named by a scene had no entry and got one ` +
        "(titled by their id — rename them in the pool):",
    );
    for (const entry of chapterRepair.created) {
      console.log(
        `  · [${entry.campaignId}] ${entry.chapterId} (${entry.scenes} scene(s) were invisible)`,
      );
    }
  }
  if (chapterRepair !== undefined && chapterRepair.blanked.length > 0) {
    // A blank `chapter_id` named no chapter, so nothing could be created for
    // it — it is now NULL, which is what "no chapter" has always meant. The
    // scenes are listed under „Ohne Kapitel"; say so, they moved.
    console.log("scene(s) carried an EMPTY chapter reference and now carry none:");
    for (const entry of chapterRepair.blanked) {
      console.log(`  · [${entry.campaignId}] ${entry.scenes} scene(s)`);
    }
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
