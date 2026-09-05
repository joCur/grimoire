// API routes (read: issue #2, write: issue #5, search/version: issues #7/#8,
// generator: issue #6, its background jobs: issue #19, the NPC run: issue #21).
// Mounted under /api in server.ts. Response shapes are the contracts in
// @grimoire/shared (types.ts).

import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getBuildId } from "../config";
import { ApiError } from "../campaign-fs";
import {
  buildTree,
  campaignVersion,
  listCampaigns,
  readActiveSession,
  readGlossary,
  readMigrationReport,
  readParsedFile,
  requireCampaign,
} from "../store/read";
import { searchCampaign } from "../store/search";
import { isRenameKind, RENAME_KINDS, renameEntity } from "../store/rename";
import { isUsageKind, readUsage, USAGE_KINDS } from "../store/usage";
import {
  appendInboxEntry,
  appendLogEntry,
  appendThreadToChapter,
  continueSession,
  createNpcStub,
  discardSession,
  endSession,
  markInboxLineDone,
  markLogLineSeen,
  patchFrontmatter,
  pauseSession,
  resumeSession,
  startSession,
  writeFileBody,
  writeGlossary,
} from "../store/write";
import {
  applyGenerated,
  assertGenerateTarget,
  assertNpcGenerateTarget,
  obtainProvider,
} from "../generator";
import {
  deleteJob,
  getJob,
  serializeJob,
  setDraftEdit,
  startJob,
} from "../generate-jobs";

export const api = new Hono();

// Map ApiError to a small JSON error body; anything else is a real 500.
api.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message, ...err.extra }, err.status as ContentfulStatusCode);
  }
  console.error(err);
  return c.json({ error: "internal server error" }, 500);
});

// Every /api response carries the server's build id (issue #24). The primary
// carrier is GET /:campaign/version (the app polls it anyway); this header is
// the cheap belt-and-braces copy for anything that talks to the API without
// that poll — curl during a deploy, a future client, the browser network tab.
// Set on the finished response so handlers that return a raw Response (not
// c.json) get it too.
api.use("*", async (c, next) => {
  await next();
  c.res.headers.set("x-grimoire-build", getBuildId());
});

// --- request body validation ---------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Parse the JSON body; must be an object with no keys outside `allowed`. */
async function jsonBody(c: Context, allowed: string[]): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, "request body must be valid JSON");
  }
  if (!isPlainObject(body)) throw new ApiError(400, "request body must be a JSON object");
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw new ApiError(400, `unknown body key: ${key}`);
  }
  return body;
}

/** Query flag: present and not `0`/`false` counts as on (`?includeEnded=1`). */
function isTruthyFlag(v: string | undefined): boolean {
  return v !== undefined && v !== "0" && v.toLowerCase() !== "false";
}

/**
 * Normalize free text destined for a single markdown list line: trim and
 * collapse any internal newline (plus surrounding spaces) to one space.
 * Returns undefined for non-strings and for text that is empty after
 * trimming.
 */
function normalizeLineText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const text = v.replace(/\s*\r?\n\s*/g, " ").trim();
  return text === "" ? undefined : text;
}

// --- read endpoints --------------------------------------------------------------

// GET /api/campaigns -> CampaignSummary[]
api.get("/campaigns", async (c) => c.json(await listCampaigns()));

// GET /api/:campaign/tree -> CampaignTree
api.get("/:campaign/tree", async (c) => c.json(await buildTree(c.req.param("campaign"))));

// GET /api/:campaign/file?path=... -> FileResponse (ParsedFile + raw)
api.get("/:campaign/file", async (c) => {
  const rel = c.req.query("path");
  if (rel === undefined) throw new ApiError(400, "missing path query parameter");
  return c.json(await readParsedFile(c.req.param("campaign"), rel));
});

// GET /api/:campaign/session -> FileResponse of the ACTIVE session (issue #40),
// 404 when no session is running. "Active" = the last STARTED session file
// without `ended` — today's or an older one, so a session that runs past
// midnight stays active instead of vanishing at 00:00.
//
// This is the one place that decides what "the running session" is: the app
// must never derive it from its own date (a browser in another timezone, or
// simply a session past midnight, would get it wrong). Same shape as GET
// /file plus `startedMs`/`endedMs` and `pausedMs`/`pausedSinceMs` — the
// server's epoch reading of the zone-less timestamps and of the `pauses`
// intervals, which is what makes the live runtime correct (AK8: paused time
// does not count).
//
// `?includeEnded=1` asks the OTHER question: the last STARTED session, ended
// or not. That is the review's session (the harvest runs right after "Session
// beenden"), and it must come from the server for the same reason: a session
// that ran past midnight was ended in YESTERDAY's file, so the client's own
// date would harvest an empty — or wrong — file. 404 when the campaign has no
// session file at all.
api.get("/:campaign/session", async (c) =>
  c.json(await readActiveSession(c.req.param("campaign"), isTruthyFlag(c.req.query("includeEnded")))),
);

// GET /api/:campaign/search?q=... -> { results: SearchResult[] } (max 20)
// Full-text search over the FTS5 index (issue #57): scenes, npcs, locations,
// chapters, the campaign document and the GLOSSARY, ranked by bm25 with the
// column weights of the index migration. Every token is a prefix term, so a
// half-typed palette query still matches, and the tokenizer folds diacritics
// ("leucht" finds "Leuchtturm"). Response shape unchanged.
api.get("/:campaign/search", async (c) => {
  const q = c.req.query("q")?.trim();
  if (q === undefined || q === "") throw new ApiError(400, "missing q query parameter");
  const campaign = c.req.param("campaign");
  await requireCampaign(campaign); // 400 unsafe id, 404 unknown campaign
  return c.json({ results: await searchCampaign(campaign, q) });
});

// GET /api/:campaign/version -> { version, build } — `version` is
// `campaigns.version`, bumped by every write in the SAME transaction as the
// change it belongs to (issue #57: with the database as the only truth there
// is no external editor left to watch, so the chokidar watcher is gone). The
// app polls this and refetches when it changes (DECISIONS #9). `build` rides
// along on that existing poll (issue #24): the app compares it with its own
// build id and offers a reload when a deploy left it with a stale bundle.
api.get("/:campaign/version", async (c) => {
  const campaign = c.req.param("campaign");
  return c.json({ version: await campaignVersion(campaign), build: getBuildId() });
});

// GET /api/:campaign/glossary -> { entries: [{ term, explanation }] }
// The glossary is a structured TABLE since the migration (planning F6): term
// → explanation instead of one markdown blob. The generic reading view still
// renders it as markdown (GET /file?path=glossary.md, rendered from these
// rows), but this is the shape anything that wants the TERMS should read —
// the generator knowledge base of issue #53 builds on exactly this.
api.get("/:campaign/glossary", async (c) => c.json(await readGlossary(c.req.param("campaign"))));

// GET /api/:campaign/migration-report -> { entries: [{ path, reason, at }] }
// What the one-time markdown migration had to degrade (planning section 3).
// An EMPTY list is the success criterion of a clean import; the app shows a
// quiet hint while there is anything in here, because it is a reading task
// for the DM — not an error.
api.get("/:campaign/migration-report", async (c) =>
  c.json({ entries: await readMigrationReport(c.req.param("campaign")) }),
);

// --- write endpoints (issue #5) ---------------------------------------------------

// PATCH /api/:campaign/frontmatter { path, mtimeMs, patch } -> FileResponse
// patch is a flat object of frontmatter keys to set; null deletes a key.
// 409 { error, mtimeMs } when the file changed on disk since it was read.
api.patch("/:campaign/frontmatter", async (c) => {
  const body = await jsonBody(c, ["path", "mtimeMs", "patch"]);
  const rel = body.path;
  const mtimeMs = body.mtimeMs;
  const patch = body.patch;
  if (typeof rel !== "string") throw new ApiError(400, "path must be a string");
  if (typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs)) {
    throw new ApiError(400, "mtimeMs must be a number");
  }
  if (!isPlainObject(patch)) throw new ApiError(400, "patch must be an object");
  return c.json(await patchFrontmatter(c.req.param("campaign"), rel, mtimeMs, patch));
});

// PUT /api/:campaign/file { path, mtimeMs, body } -> FileResponse
// Writes the markdown BODY of an existing file — `body` is the markdown
// WITHOUT the frontmatter block, exactly what GET /file returns as `body`.
// The frontmatter block on disk stays byte-identical (keys are PATCH
// /frontmatter's job). Same mtime guard: 409 { error, mtimeMs } when the file
// changed on disk since it was read; 404 for a file that does not exist; 400
// for the append-only kinds (sessions/*.md, inbox.md — DECISIONS #4) and for a
// file whose frontmatter block cannot be split off safely.
api.put("/:campaign/file", async (c) => {
  const body = await jsonBody(c, ["path", "mtimeMs", "body"]);
  const rel = body.path;
  const mtimeMs = body.mtimeMs;
  const markdown = body.body;
  if (typeof rel !== "string") throw new ApiError(400, "path must be a string");
  if (typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs)) {
    throw new ApiError(400, "mtimeMs must be a number");
  }
  if (typeof markdown !== "string") throw new ApiError(400, "body must be a string");
  return c.json(await writeFileBody(c.req.param("campaign"), rel, mtimeMs, markdown));
});

// POST /api/:campaign/campaign-meta is GONE (issue #62). It was the create
// half of the metadata dialog (issue #34), for the case PATCH /frontmatter
// cannot serve: no `_campaign.md`, hence no guard token to write against.
// Since the cutover every campaign HAS a row, so GET /file?path=_campaign.md
// always answers 200 with a `rev` and there is no create case left — the
// endpoint had become unreachable from the app (#59). Name and description
// are written like every other frontmatter field now, through PATCH
// /frontmatter and its 409.

// POST /api/:campaign/session/start -> FileResponse
// Creates sessions/<today>.md. Idempotent while TODAY's session is the running
// one (pressing the button twice re-enters it). Two 409s instead of a silent
// surprise (issue #40 review):
//   { code: "session_running", path } — an OLDER session is still open (past
//     midnight, or never ended). The app offers to end that one; nothing
//     starts a second parallel session.
//   { code: "session_ended", path } — today's session is already ended. The
//     app offers POST /session/resume; before, the ended file came back with
//     200 and the Start button did nothing until midnight.
api.post("/:campaign/session/start", async (c) =>
  c.json(await startSession(c.req.param("campaign"))),
);

// POST /api/:campaign/session/resume -> FileResponse — re-opens the last
// started session by REMOVING `ended` (the explicit undo of an accidental
// "Session beenden", issue #40 review). 404 without any session file, 409
// { path } when that session is still running.
api.post("/:campaign/session/resume", async (c) =>
  c.json(await resumeSession(c.req.param("campaign"))),
);

// POST /api/:campaign/session/end -> FileResponse — ends the ACTIVE session
// (issue #40: that may be yesterday's file when the session ran past
// midnight). Idempotent — with nothing running the LAST STARTED session is
// returned with its existing `ended`; 404 when there is no session file at
// all.
api.post("/:campaign/session/end", async (c) => c.json(await endSession(c.req.param("campaign"))));

// POST /api/:campaign/session/pause -> FileResponse — really STOPS the clock
// (issue #40 AK8): opens a `{ from: … }` interval in the session's `pauses`
// frontmatter AND appends the `— Pause` log line in the same write. Idempotent
// (already paused -> 200, file unchanged); 404 when no session is running.
api.post("/:campaign/session/pause", async (c) =>
  c.json(await pauseSession(c.req.param("campaign"))),
);

// POST /api/:campaign/session/continue -> FileResponse — closes the open pause
// interval (`to`) and appends `— Weiter`. NOT named `resume`: that endpoint
// re-opens an ENDED session. Idempotent (not paused -> 200, file unchanged);
// 404 when no session is running.
api.post("/:campaign/session/continue", async (c) =>
  c.json(await continueSession(c.req.param("campaign"))),
);

// POST /api/:campaign/session/discard -> { path } — DELETES the active
// session's file (issue #40 AK7), the undo of a mis-clicked "Session
// starten". Allowed ONLY while that session is empty (no log entry, no
// `scenes_played`); otherwise 409 { code: "session_not_empty", path } — a
// session with content is ended, never deleted. 404 when nothing is running.
api.post("/:campaign/session/discard", async (c) =>
  c.json(await discardSession(c.req.param("campaign"))),
);

// POST /api/:campaign/log { text, sceneId? } -> FileResponse
// Appends `- HH:MM (sceneId) text` to the ACTIVE session (issue #40 — not
// stubbornly to today's file); 404 when no session is running — including
// right after "Session beenden", where a note used to land in the closed log.
api.post("/:campaign/log", async (c) => {
  const body = await jsonBody(c, ["text", "sceneId"]);
  const text = normalizeLineText(body.text);
  if (text === undefined) throw new ApiError(400, "text must be a non-empty string");
  let sceneId: string | undefined;
  if (body.sceneId !== undefined && body.sceneId !== null) {
    if (typeof body.sceneId !== "string") throw new ApiError(400, "sceneId must be a string");
    sceneId = normalizeLineText(body.sceneId);
  }
  return c.json(await appendLogEntry(c.req.param("campaign"), text, sceneId));
});

// POST /api/:campaign/inbox { text } -> FileResponse (creates inbox.md)
api.post("/:campaign/inbox", async (c) => {
  const body = await jsonBody(c, ["text"]);
  const text = normalizeLineText(body.text);
  if (text === undefined) throw new ApiError(400, "text must be a non-empty string");
  return c.json(await appendInboxEntry(c.req.param("campaign"), text));
});

// PUT /api/:campaign/glossary { entries: [{ term, explanation }] }
//   -> { entries }
// Replaces the WHOLE list: the glossary is a short, hand-curated table and is
// edited as a whole, so there is nothing an entry-level guard would protect.
// Duplicate terms follow the import's rule — the first one wins.
api.put("/:campaign/glossary", async (c) => {
  const body = await jsonBody(c, ["entries"]);
  const raw = body.entries;
  if (!Array.isArray(raw)) throw new ApiError(400, "entries must be an array");
  const entries: Array<{ term: string; explanation: string }> = [];
  for (const item of raw) {
    if (!isPlainObject(item)) throw new ApiError(400, "each entry must be an object");
    if (typeof item.term !== "string" || item.term.trim() === "") {
      throw new ApiError(400, "each entry needs a non-empty term");
    }
    if (item.explanation !== undefined && typeof item.explanation !== "string") {
      throw new ApiError(400, "explanation must be a string");
    }
    entries.push({ term: item.term, explanation: item.explanation ?? "" });
  }
  return c.json(await writeGlossary(c.req.param("campaign"), entries));
});

// --- rename with reference cascade (issue #30) --------------------------------------

// POST /api/:campaign/rename { kind, oldId, newId, dryRun? }
//   -> { renamed: { from, to }, changed: string[] }
// Renames the entity id (a database UPDATE with a cascade) and patches
// every reference site of the format contract — see store/rename.ts for
// the list, the plan/execute split and the write order. Prose mentions are
// deliberately left alone.
// 400 unknown kind / invalid or unchanged newId, 404 unknown id,
// 409 { path } when the target exists. `dryRun: true` answers with the very
// same plan and writes nothing (the UI's "betrifft N Dateien" preview).
api.post("/:campaign/rename", async (c) => {
  const body = await jsonBody(c, ["kind", "oldId", "newId", "dryRun"]);
  if (!isRenameKind(body.kind)) {
    throw new ApiError(400, `kind must be one of: ${RENAME_KINDS.join(", ")}`);
  }
  if (typeof body.oldId !== "string") throw new ApiError(400, "oldId must be a string");
  if (typeof body.newId !== "string") throw new ApiError(400, "newId must be a string");
  if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
    throw new ApiError(400, "dryRun must be a boolean");
  }
  return c.json(
    await renameEntity(
      c.req.param("campaign"),
      body.kind,
      body.oldId.trim(),
      body.newId.trim(),
      body.dryRun === true,
    ),
  );
});

// --- usage: where is this entity referenced? (issue #60) ---------------------------

// GET /api/:campaign/usage?kind=<npc|location|scene|chapter>&id=<slug>
//   -> { kind, id, path, total, groups: [{ ref, count, sites: [{ kind, id, title,
//        path, count }] }] }
// The reference count of one entity, as queries over the reference tables
// (store/usage.ts): scene `npcs`/`location`/`chapter`, another npc's
// `## Beziehungen` line, session `scenes_played`, log scene markers. A group
// counts ROWS, its sites are the referencing DOCUMENTS. Same queries the
// rename's `dryRun` answers with, so the preview counts what the cascade
// rewrites.
// 404 unknown campaign or entity, 400 unknown/missing kind or empty id.
api.get("/:campaign/usage", async (c) => {
  // Campaign first, then the query — the order renameEntity uses, so an
  // unknown campaign answers 404 whatever the query looks like (server.ts).
  await requireCampaign(c.req.param("campaign"));
  const kind = c.req.query("kind");
  if (!isUsageKind(kind)) {
    throw new ApiError(400, `kind must be one of: ${USAGE_KINDS.join(", ")}`);
  }
  const id = (c.req.query("id") ?? "").trim();
  if (id === "") throw new ApiError(400, "id is required");
  return c.json(await readUsage(c.req.param("campaign"), kind, id));
});

// --- review-action endpoints (issue #10) --------------------------------------------

/** One raw log/inbox line as sent by the review UI: non-empty, single line. */
function rawLine(v: unknown, what: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new ApiError(400, `${what} must be a non-empty string`);
  }
  if (v.includes("\n") || v.includes("\r")) {
    throw new ApiError(400, `${what} must be a single line`);
  }
  return v;
}

// POST /api/:campaign/review/seen { path, line } -> FileResponse
// Adds the short hash (first 8 hex chars of SHA-256) of the RAW log line to
// the session's `reviewed` frontmatter list iff absent. Idempotent; the line
// is hashed exactly as sent — it is never written anywhere.
api.post("/:campaign/review/seen", async (c) => {
  const body = await jsonBody(c, ["path", "line"]);
  if (typeof body.path !== "string") throw new ApiError(400, "path must be a string");
  const line = rawLine(body.line, "line");
  return c.json(await markLogLineSeen(c.req.param("campaign"), body.path, line));
});

// POST /api/:campaign/review/thread { chapter, text } -> FileResponse
// Appends `- [ ] text` under ## Offene Fäden of <chapter>/_chapter.md
// (section/file created when missing; 404 when the chapter dir is missing).
api.post("/:campaign/review/thread", async (c) => {
  const body = await jsonBody(c, ["chapter", "text"]);
  if (typeof body.chapter !== "string") throw new ApiError(400, "chapter must be a string");
  const text = normalizeLineText(body.text);
  if (text === undefined) throw new ApiError(400, "text must be a non-empty string");
  return c.json(await appendThreadToChapter(c.req.param("campaign"), body.chapter, text));
});

// POST /api/:campaign/review/npc-stub { id, name?, note? } -> FileResponse
// Creates npcs/<id>.md (status: unknown); 409 { error, path } when the slug
// already exists — never overwrites.
api.post("/:campaign/review/npc-stub", async (c) => {
  const body = await jsonBody(c, ["id", "name", "note"]);
  if (typeof body.id !== "string") throw new ApiError(400, "id must be a string");
  let name: string | undefined;
  if (body.name !== undefined && body.name !== null) {
    if (typeof body.name !== "string") throw new ApiError(400, "name must be a string");
    name = normalizeLineText(body.name); // empty after trim -> default (the id)
  }
  let note: string | undefined;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") throw new ApiError(400, "note must be a string");
    note = normalizeLineText(body.note); // empty after trim -> no note line
  }
  return c.json(await createNpcStub(c.req.param("campaign"), body.id, name, note));
});

// POST /api/:campaign/review/inbox-done { line } -> FileResponse
// Rewrites the FIRST exactly-matching inbox line to `- [x] …` (the one
// documented append-only exception). Idempotent; 404 when not found.
api.post("/:campaign/review/inbox-done", async (c) => {
  const body = await jsonBody(c, ["line"]);
  const line = rawLine(body.line, "line");
  if (!line.startsWith("- ")) {
    throw new ApiError(400, "line must be an inbox list line (starting with '- ')");
  }
  return c.json(await markInboxLineDone(c.req.param("campaign"), line));
});

// --- generator endpoints (issue #6) -------------------------------------------------

// POST /api/:campaign/generate { chapter, sourceText, newChapter? } ->
// 202 { jobId }. Starts a BACKGROUND job (issue #19) and returns
// immediately; the result is picked up via GET …/generate/job. Writes
// NOTHING (generator/README.md).
//
// Everything cheap stays a synchronous answer, BEFORE a job exists — a
// request error must not turn into a failed job the DM has to go and read:
// 400 for a malformed body/unsafe chapter id, 404 for an unknown
// campaign/chapter (unless newChapter marks the app's new-chapter flow,
// where the directory is created on apply), 503 when no provider is
// configured (e.g. ANTHROPIC_API_KEY missing). 409 { error, jobId } while a
// job for this campaign is still running — one job per campaign.
// The run's own outcome (incl. the 422 of issues #18/#20) lands in the job.
api.post("/:campaign/generate", async (c) => {
  const body = await jsonBody(c, ["chapter", "sourceText", "newChapter"]);
  const campaign = c.req.param("campaign");
  const chapter = body.chapter;
  const sourceText = body.sourceText;
  const newChapter = body.newChapter;
  if (typeof chapter !== "string" || chapter.trim() === "") {
    throw new ApiError(400, "chapter must be a non-empty string");
  }
  if (typeof sourceText !== "string" || sourceText.trim() === "") {
    throw new ApiError(400, "sourceText must be a non-empty string");
  }
  if (newChapter !== undefined && typeof newChapter !== "boolean") {
    throw new ApiError(400, "newChapter must be a boolean");
  }
  await assertGenerateTarget(campaign, chapter, newChapter === true); // 400/404
  const provider = obtainProvider(); // 503 when nothing is configured
  const job = await startJob({
    kind: "scene",
    campaign,
    chapter,
    sourceText,
    newChapter: newChapter === true,
    provider,
  });
  return c.json({ jobId: job.id }, 202);
});

// POST /api/:campaign/generate/npc { sourceText, id? } -> 202 { jobId }
// One NPC file from source material (issue #21) — the same background job
// model as the scene run: ONE generator job per campaign, so a start while
// ANY run (scene or npc) is going answers 409 { jobId }. Writes NOTHING.
//
// Synchronous, before a job exists: 400 for a malformed body or an id that is
// not a kebab slug, 404 for an unknown campaign, 409 { path } when the pinned
// id's file already exists (never overwrite — enriching an existing NPC file
// is an explicit non-goal), 503 without a configured provider.
// `id` is optional: without it the model picks the id, and a collision with
// an existing npc becomes a correction turn.
api.post("/:campaign/generate/npc", async (c) => {
  const body = await jsonBody(c, ["sourceText", "id"]);
  const campaign = c.req.param("campaign");
  const sourceText = body.sourceText;
  if (typeof sourceText !== "string" || sourceText.trim() === "") {
    throw new ApiError(400, "sourceText must be a non-empty string");
  }
  let npcId: string | undefined;
  if (body.id !== undefined && body.id !== null) {
    if (typeof body.id !== "string") throw new ApiError(400, "id must be a string");
    npcId = body.id.trim();
    if (npcId === "") npcId = undefined; // an empty field means "model chooses"
  }
  await assertNpcGenerateTarget(campaign, npcId); // 400/404/409
  const provider = obtainProvider(); // 503 when nothing is configured
  const job = await startJob({
    kind: "npc",
    campaign,
    sourceText,
    ...(npcId === undefined ? {} : { npcId }),
    provider,
  });
  return c.json({ jobId: job.id }, 202);
});

// GET /api/:campaign/generate/job -> GenerateJob (404 when there is none).
// The campaign is NOT re-validated here: the job store is the authority for
// this endpoint, and "no job" is the honest answer for an unknown campaign
// too. Polled by the generator route while a job runs (~3s) and once per
// campaign mount by the topbar's run indicator.
api.get("/:campaign/generate/job", async (c) => {
  const job = await getJob(c.req.param("campaign"));
  if (job === undefined) throw new ApiError(404, "no generate job for this campaign");
  return c.json(serializeJob(job));
});

// DELETE /api/:campaign/generate/job -> { deleted: true } ("Verwerfen").
// Works for every status — a running job is abandoned, its result never
// lands (see finish() in generate-jobs.ts). 404 when there is none.
api.delete("/:campaign/generate/job", async (c) => {
  if (!(await deleteJob(c.req.param("campaign")))) {
    throw new ApiError(404, "no generate job for this campaign");
  }
  return c.json({ deleted: true });
});

// PUT /api/:campaign/generate/job/drafts { path, markdown } -> { path }
// One review edit into the job store, so edits survive navigation as well
// (issue #19 AK3). 404 without a job, 400 when the path is not one of the
// result's scene paths. The markdown is stored verbatim and NOT validated
// here — apply re-validates everything server-side anyway, and a
// half-written draft must still be storable while the DM types.
api.put("/:campaign/generate/job/drafts", async (c) => {
  const body = await jsonBody(c, ["path", "markdown"]);
  const rel = body.path;
  const markdown = body.markdown;
  if (typeof rel !== "string" || rel === "") throw new ApiError(400, "path must be a string");
  if (typeof markdown !== "string") throw new ApiError(400, "markdown must be a string");
  await setDraftEdit(c.req.param("campaign"), rel, markdown);
  return c.json({ path: rel });
});

// POST /api/:campaign/generate/apply
// { scenes?, stubs?, npc?, chapter?, chapterTitle?, jobId? } -> { written }
// Writes the reviewed drafts — synchronous on purpose: this is a short file
// write, and the DM waits for its result. Re-validates server-side
// (frontmatter parses, status draft, safe paths); 409 { conflicts } when any
// target file exists — then nothing is written at all. chapter +
// chapterTitle (both or neither) additionally create `<chapter>/_chapter.md`
// when it is missing, in the same all-or-nothing batch (the app's "Neues
// Kapitel" flow).
// `jobId` (issue #19) ties the apply to the background job it came from: a
// SUCCESSFUL apply discards that job — the drafts are stored, there is
// nothing left to restore. A stale id (a newer run started meanwhile) is
// ignored rather than dropping the wrong job. Since issue #62 that discard is
// part of the write TRANSACTION (store/write.ts applyDrafts), so drafts and
// job can never disagree after a crash.
// `npc` is the NPC generator's one draft (issue #21) — deliberately the SAME
// endpoint: it needs exactly the same all-or-nothing write, the same 409 and
// the same job cleanup, and re-validates server-side just like a scene.
api.post("/:campaign/generate/apply", async (c) => {
  const body = await jsonBody(c, ["scenes", "stubs", "npc", "chapter", "chapterTitle", "jobId"]);
  const campaign = c.req.param("campaign");
  const jobId = body.jobId;
  if (jobId !== undefined && typeof jobId !== "string") {
    throw new ApiError(400, "jobId must be a string");
  }
  const written = await applyGenerated(campaign, body, jobId);
  return c.json(written);
});
