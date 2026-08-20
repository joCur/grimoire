// Typed client for the Grimoire server API (endpoint list documented in
// server/src/server.ts). All response shapes come from @grimoire/shared —
// the format contract exists exactly once.

import type {
  CampaignSummary,
  CampaignTree,
  FileResponse,
  SearchResponse,
} from "@grimoire/shared/types";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`);
  if (!response.ok) {
    throw new ApiError(response.status, `GET /api${path} → ${response.status}`);
  }
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
 */
export function fetchVersion(campaign: string): Promise<{ version: number }> {
  return getJson<{ version: number }>(`/${encodeURIComponent(campaign)}/version`);
}

// --- write endpoints (session/log, issue #9) --------------------------------

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new ApiError(response.status, `POST /api${path} → ${response.status}`);
  }
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
 * Create `npcs/<id>.md` (status: unknown, note under `## Notizen`).
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
