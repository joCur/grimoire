// API routes (read: issue #2, write: issue #5, search/version: issues #7/#8).
// Mounted under /api in server.ts. Response shapes are the contracts in
// @grimoire/shared (types.ts).

import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ApiError, buildTree, campaignDir, listCampaigns, readParsedFile } from "../campaign-fs";
import { getCampaignVersion, searchCampaign } from "../search-index";
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
import { applyGenerated, runGenerate } from "../generator";

export const api = new Hono();

// Map ApiError to a small JSON error body; anything else is a real 500.
api.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message, ...err.extra }, err.status as ContentfulStatusCode);
  }
  console.error(err);
  return c.json({ error: "internal server error" }, 500);
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

// GET /api/:campaign/version -> { version } — bumped by the file watcher on
// every markdown change; the app polls this and refetches when it changes
// (polling instead of SSE, DECISIONS #9).
api.get("/:campaign/version", async (c) => {
  const campaign = c.req.param("campaign");
  await campaignDir(campaign);
  return c.json({ version: getCampaignVersion(campaign) });
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
// GenerateResult. Review preview only — writes NOTHING
// (generator/README.md). 404 when the chapter does not exist (unless
// newChapter marks the app's new-chapter flow, where the directory is
// created on apply), 422 when the LLM reply keeps failing mechanical
// validation, 503 when no provider is configured (e.g. ANTHROPIC_API_KEY
// missing); the provider is instantiated lazily per request.
api.post("/:campaign/generate", async (c) => {
  const body = await jsonBody(c, ["chapter", "sourceText", "newChapter"]);
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
  return c.json(
    await runGenerate(c.req.param("campaign"), chapter, sourceText, newChapter === true),
  );
});

// POST /api/:campaign/generate/apply { scenes, stubs, chapter?, chapterTitle? }
// -> { written }
// Writes the reviewed drafts. Re-validates server-side (frontmatter parses,
// status draft, safe paths); 409 { conflicts } when any target file exists —
// then nothing is written at all. chapter + chapterTitle (both or neither)
// additionally create `<chapter>/_chapter.md` when it is missing, in the same
// all-or-nothing batch (the app's "Neues Kapitel" flow).
api.post("/:campaign/generate/apply", async (c) => {
  const body = await jsonBody(c, ["scenes", "stubs", "chapter", "chapterTitle"]);
  return c.json(
    await applyGenerated(
      c.req.param("campaign"),
      body.scenes,
      body.stubs,
      body.chapter,
      body.chapterTitle,
    ),
  );
});
