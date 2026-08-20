// API routes (read: issue #2, write: issue #5, search/version: issues #7/#8,
// generator: issue #6, its background jobs: issue #19, the NPC run: issue #21).
// Mounted under /api in server.ts. Response shapes are the contracts in
// @grimoire/shared (types.ts).

import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getBuildId } from "../config";
import { ApiError, buildTree, campaignDir, listCampaigns, readParsedFile } from "../campaign-fs";
import { getCampaignVersion, searchCampaign } from "../search-index";
import { isRenameKind, RENAME_KINDS, renameEntity } from "../campaign-rename";
import {
  appendInboxEntry,
  appendLogEntry,
  appendThreadToChapter,
  createNpcStub,
  endSession,
  markInboxLineDone,
  markLogLineSeen,
  patchFrontmatter,
  startSession,
} from "../campaign-write";
import {
  applyGenerated,
  assertGenerateTarget,
  assertNpcGenerateTarget,
  obtainProvider,
} from "../generator";
import {
  deleteJob,
  deleteJobIfCurrent,
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

// GET /api/:campaign/search?q=... -> { results: SearchResult[] } (max 20)
// Fuzzy in-memory search (Fuse.js) over scenes/npcs/locations/chapters and
// the campaign file;
// the index builds lazily per campaign and the file watcher invalidates it.
api.get("/:campaign/search", async (c) => {
  const q = c.req.query("q")?.trim();
  if (q === undefined || q === "") throw new ApiError(400, "missing q query parameter");
  const campaign = c.req.param("campaign");
  await campaignDir(campaign); // 400 unsafe id, 404 unknown campaign
  return c.json({ results: await searchCampaign(campaign, q) });
});

// GET /api/:campaign/version -> { version, build } — `version` is bumped by
// the file watcher on every markdown change; the app polls this and refetches
// when it changes (polling instead of SSE, DECISIONS #9). `build` rides along
// on that existing poll (issue #24): the app compares it with its own build id
// and offers a reload when a deploy left it with a stale bundle. No extra
// request, no extra polling loop.
api.get("/:campaign/version", async (c) => {
  const campaign = c.req.param("campaign");
  await campaignDir(campaign);
  return c.json({ version: getCampaignVersion(campaign), build: getBuildId() });
});

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

// POST /api/:campaign/session/start -> FileResponse (idempotent per day)
api.post("/:campaign/session/start", async (c) =>
  c.json(await startSession(c.req.param("campaign"))),
);

// POST /api/:campaign/session/end -> FileResponse (404 without a session
// today; idempotent — the first `ended` wins)
api.post("/:campaign/session/end", async (c) => c.json(await endSession(c.req.param("campaign"))));

// POST /api/:campaign/log { text, sceneId? } -> FileResponse
// Appends `- HH:MM (sceneId) text` to today's session; 404 without a session.
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

// --- rename with reference cascade (issue #30) --------------------------------------

// POST /api/:campaign/rename { kind, oldId, newId, dryRun? }
//   -> { renamed: { from, to }, changed: string[] }
// Renames the entity's file (a DIRECTORY for kind "chapter") and patches
// every reference site of the format contract — see campaign-rename.ts for
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
  const job = startJob({
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
  const job = startJob({
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
api.get("/:campaign/generate/job", (c) => {
  const job = getJob(c.req.param("campaign"));
  if (job === undefined) throw new ApiError(404, "no generate job for this campaign");
  return c.json(serializeJob(job));
});

// DELETE /api/:campaign/generate/job -> { deleted: true } ("Verwerfen").
// Works for every status — a running job is abandoned, its result never
// lands (see finish() in generate-jobs.ts). 404 when there is none.
api.delete("/:campaign/generate/job", (c) => {
  if (!deleteJob(c.req.param("campaign"))) {
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
  setDraftEdit(c.req.param("campaign"), rel, markdown);
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
// SUCCESSFUL apply discards that job — the drafts are on disk, there is
// nothing left to restore. A stale id (a newer run started meanwhile) is
// ignored rather than dropping the wrong job.
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
  const written = await applyGenerated(campaign, body);
  if (typeof jobId === "string") deleteJobIfCurrent(campaign, jobId);
  return c.json(written);
});
