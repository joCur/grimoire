// Typed client for the Grimoire server API (endpoint list documented in
// server/src/server.ts). All response shapes come from @grimoire/shared —
// the format contract exists exactly once.

import type {
  CampaignSummary,
  CampaignTree,
  FileResponse,
  GenerateJob,
  GenerateJobStarted,
  GeneratedStub,
  SearchResponse,
} from "@grimoire/shared/types";

export class ApiError extends Error {
  readonly status: number;
  /**
   * The server's JSON error body when there was one — the endpoints answer
   * `{ error, … }` and put the interesting parts next to it (`conflicts` on
   * 409, `validationErrors`/`rawReply`/`usage` on the generator's 422,
   * `mtimeMs` on a frontmatter conflict).
   */
  readonly details: Record<string, unknown>;

  constructor(status: number, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

/** Build the ApiError for a failed response, keeping the JSON error body. */
async function failure(what: string, response: Response): Promise<ApiError> {
  let details: Record<string, unknown> = {};
  try {
    const body: unknown = await response.json();
    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      details = body as Record<string, unknown>;
    }
  } catch {
    // no/!JSON body — the status is all we know
  }
  const message = typeof details.error === "string" ? details.error : undefined;
  return new ApiError(response.status, `${what} → ${response.status}${message === undefined ? "" : `: ${message}`}`, details);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`);
  if (!response.ok) throw await failure(`GET /api${path}`, response);
  return (await response.json()) as T;
}

export function fetchCampaigns(): Promise<CampaignSummary[]> {
  return getJson<CampaignSummary[]>("/campaigns");
}

export function fetchTree(campaign: string): Promise<CampaignTree> {
  return getJson<CampaignTree>(`/${encodeURIComponent(campaign)}/tree`);
}

export function fetchFile(campaign: string, path: string): Promise<FileResponse> {
  return getJson<FileResponse>(
    `/${encodeURIComponent(campaign)}/file?path=${encodeURIComponent(path)}`,
  );
}

/**
 * Fuzzy search over scenes/npcs/locations/chapters (max 20 results).
 * The server 400s on an empty/whitespace query — callers must not send one.
 */
export function fetchSearch(campaign: string, q: string): Promise<SearchResponse> {
  return getJson<SearchResponse>(
    `/${encodeURIComponent(campaign)}/search?q=${encodeURIComponent(q)}`,
  );
}

/**
 * Campaign version counter (issue #8) — bumped by the server's file watcher
 * on every markdown change; polled by useCampaignVersion.
 *
 * `build` (issue #24) is the server's build id, riding along on this poll so
 * the handshake costs no extra request. Optional in the type because an older
 * server (or a stale tab talking to one) may not send it.
 */
export interface VersionResponse {
  version: number;
  build?: string;
}

export function fetchVersion(campaign: string): Promise<VersionResponse> {
  return getJson<VersionResponse>(`/${encodeURIComponent(campaign)}/version`);
}

// --- write endpoints (session/log, issue #9) --------------------------------

/**
 * Set/delete frontmatter keys of one file (issue #5 endpoint, used by the
 * scene-status control of issue #28). `patch` is flat: a value sets the key,
 * `null` deletes it. `mtimeMs` is the optimistic-concurrency token and must be
 * the one from the FileResponse the UI is showing — when the file changed on
 * disk since, the server answers 409 with the current `mtimeMs` in
 * `ApiError.details` and writes nothing.
 */
export async function patchFrontmatter(
  campaign: string,
  input: { path: string; mtimeMs: number; patch: Record<string, unknown> },
): Promise<FileResponse> {
  const path = `/${encodeURIComponent(campaign)}/frontmatter`;
  const response = await fetch(`/api${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await failure(`PATCH /api${path}`, response);
  return (await response.json()) as FileResponse;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await failure(`POST /api${path}`, response);
  return (await response.json()) as T;
}

/** Create today's session file (idempotent — an existing one is returned). */
export function startSession(campaign: string): Promise<FileResponse> {
  return postJson<FileResponse>(`/${encodeURIComponent(campaign)}/session/start`);
}

/** Set `ended` in today's session file (404 without a session today). */
export function endSession(campaign: string): Promise<FileResponse> {
  return postJson<FileResponse>(`/${encodeURIComponent(campaign)}/session/end`);
}

/**
 * Append a line to the campaign's inbox.md (mobile capture, issue #11);
 * the server creates the file on the first entry.
 */
export function appendInbox(campaign: string, text: string): Promise<FileResponse> {
  return postJson<FileResponse>(`/${encodeURIComponent(campaign)}/inbox`, { text });
}

/**
 * Append a log line to today's session (404 without a session today).
 * With a sceneId the server also maintains `scenes_played`.
 */
export function appendLog(
  campaign: string,
  text: string,
  sceneId?: string,
): Promise<FileResponse> {
  return postJson<FileResponse>(
    `/${encodeURIComponent(campaign)}/log`,
    sceneId === undefined ? { text } : { text, sceneId },
  );
}

// --- review actions (issue #10) ---------------------------------------------

/**
 * Mark a log line as reviewed: the server adds the short hash of the RAW
 * line to the session's `reviewed` list (idempotent). Returns the session file.
 */
export function markLogLineSeen(
  campaign: string,
  path: string,
  line: string,
): Promise<FileResponse> {
  return postJson<FileResponse>(`/${encodeURIComponent(campaign)}/review/seen`, { path, line });
}

/**
 * Append `- [ ] text` under `## Offene Fäden` of the chapter's _chapter.md
 * (section created when missing). Returns the chapter file.
 */
export function adoptThread(
  campaign: string,
  chapter: string,
  text: string,
): Promise<FileResponse> {
  return postJson<FileResponse>(`/${encodeURIComponent(campaign)}/review/thread`, {
    chapter,
    text,
  });
}

/**
 * Create `npcs/<id>.md` (status: alive, note under `## Notizen`).
 * Never overwrites: an existing slug is an ApiError with status 409.
 */
export function createNpcStub(
  campaign: string,
  id: string,
  name?: string,
  note?: string,
): Promise<FileResponse> {
  return postJson<FileResponse>(`/${encodeURIComponent(campaign)}/review/npc-stub`, {
    id,
    ...(name === undefined ? {} : { name }),
    ...(note === undefined ? {} : { note }),
  });
}

/**
 * Rewrite an inbox line to `- [x] …` (the one documented exception to the
 * inbox's append-only rule). Idempotent; the line must match byte for byte.
 * Returns inbox.md.
 */
export function markInboxLineDone(campaign: string, line: string): Promise<FileResponse> {
  return postJson<FileResponse>(`/${encodeURIComponent(campaign)}/review/inbox-done`, { line });
}

// --- generator (issue #12) ---------------------------------------------------

/**
 * Start a generator run for one chapter — a BACKGROUND job since issue #19:
 * the server answers 202 with the job id and the result is fetched via
 * fetchGenerateJob. Nothing is written (generator/README.md); `newChapter`
 * allows a chapter directory that does not exist yet (created by
 * applyDrafts below).
 *
 * A 409 is NOT an error here: it means a job for this campaign is already
 * running, and its id is the answer to "start a run" — the view adopts the
 * running job instead of showing a failure. Everything else throws as
 * usual; worth handling are 503 (no provider configured — no API key), 404
 * (unknown chapter) and 400.
 *
 * The run's own failure (the 422 of issues #18/#20 with `rawReply`, `usage`
 * and possibly `validationErrors`) never comes back from THIS call — it
 * lands in the job's `error.body`.
 */
export async function startGenerateJob(
  campaign: string,
  input: { chapter: string; sourceText: string; newChapter?: boolean },
): Promise<GenerateJobStarted> {
  const path = `/${encodeURIComponent(campaign)}/generate`;
  const response = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chapter: input.chapter,
      sourceText: input.sourceText,
      ...(input.newChapter === true ? { newChapter: true } : {}),
    }),
  });
  if (!response.ok) {
    const error = await failure(`POST /api${path}`, response);
    if (error.status === 409 && typeof error.details.jobId === "string") {
      return { jobId: error.details.jobId };
    }
    throw error;
  }
  return (await response.json()) as GenerateJobStarted;
}

/**
 * Start an NPC run (issue #21): source material in, ONE npc file draft out.
 * Same job model as the scene run — 202 { jobId }, the result is fetched via
 * fetchGenerateJob (`kind: "npc"`, `npcResult`), and a 409 that carries a
 * jobId means "a generator job is already running for this campaign" and is
 * adopted instead of shown as an error.
 *
 * `id` is optional: empty means the model picks the id. A 409 WITHOUT a jobId
 * is the other collision — the pinned id's file already exists (never
 * overwritten); its `details.path` names the file.
 */
export async function startGenerateNpcJob(
  campaign: string,
  input: { sourceText: string; id?: string },
): Promise<GenerateJobStarted> {
  const path = `/${encodeURIComponent(campaign)}/generate/npc`;
  const response = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceText: input.sourceText,
      ...(input.id === undefined || input.id === "" ? {} : { id: input.id }),
    }),
  });
  if (!response.ok) {
    const error = await failure(`POST /api${path}`, response);
    if (error.status === 409 && typeof error.details.jobId === "string") {
      return { jobId: error.details.jobId };
    }
    throw error;
  }
  return (await response.json()) as GenerateJobStarted;
}

/**
 * The campaign's generate job, or null when there is none (the server's 404
 * is the normal "nothing running, nothing to restore" answer — never an
 * error state in the UI). A `null` after a job WAS there means it is gone:
 * applied, discarded, or lost to a server restart (jobs are in-memory only).
 */
export async function fetchGenerateJob(campaign: string): Promise<GenerateJob | null> {
  const path = `/${encodeURIComponent(campaign)}/generate/job`;
  const response = await fetch(`/api${path}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await failure(`GET /api${path}`, response);
  return (await response.json()) as GenerateJob;
}

/** Discard the campaign's generate job ("Verwerfen"). A missing job is fine. */
export async function deleteGenerateJob(campaign: string): Promise<void> {
  const path = `/${encodeURIComponent(campaign)}/generate/job`;
  const response = await fetch(`/api${path}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw await failure(`DELETE /api${path}`, response);
  }
}

/**
 * Keep one review edit in the job store, so an edited draft survives
 * navigation and reload (issue #19). Debounced by the caller; the local
 * editor state stays authoritative while typing.
 */
export async function putDraftEdit(
  campaign: string,
  path: string,
  markdown: string,
): Promise<void> {
  const url = `/${encodeURIComponent(campaign)}/generate/job/drafts`;
  const response = await fetch(`/api${url}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, markdown }),
  });
  if (!response.ok) throw await failure(`PUT /api${url}`, response);
}

/**
 * Write the reviewed drafts (all or nothing): the possibly edited scene
 * markdown plus the accepted stubs. With `chapter` + `chapterTitle` the
 * server also creates `<chapter>/_chapter.md` when it is missing.
 * ApiError 409 carries the existing paths in `details.conflicts` — nothing
 * was written then.
 *
 * `jobId` hands the server the job these drafts came from: a successful
 * apply discards it (the drafts are on disk — nothing left to restore).
 */
export function applyDrafts(
  campaign: string,
  input: {
    scenes: Array<{ path: string; markdown: string }>;
    stubs: GeneratedStub[];
    chapter?: string;
    chapterTitle?: string;
    jobId?: string;
  },
): Promise<{ written: string[] }> {
  return postJson<{ written: string[] }>(`/${encodeURIComponent(campaign)}/generate/apply`, {
    scenes: input.scenes,
    stubs: input.stubs,
    ...(input.chapter === undefined || input.chapterTitle === undefined
      ? {}
      : { chapter: input.chapter, chapterTitle: input.chapterTitle }),
    ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
  });
}

/**
 * Write the reviewed NPC draft (issue #21) — the same apply endpoint as the
 * scene drafts: it re-validates server-side (path, id, status, parseable
 * frontmatter), answers 409 with `details.conflicts` when the file already
 * exists (nothing written), and drops the job the draft came from.
 */
export function applyNpcDraft(
  campaign: string,
  input: { npc: { path: string; markdown: string }; jobId?: string },
): Promise<{ written: string[] }> {
  return postJson<{ written: string[] }>(`/${encodeURIComponent(campaign)}/generate/apply`, {
    npc: input.npc,
    ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
  });
}
