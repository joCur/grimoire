// Typed client for the Grimoire server API (endpoint list documented in
// server/src/server.ts). All response shapes come from @grimoire/shared —
// the format contract exists exactly once.

import type { CampaignSummary, CampaignTree, FileResponse } from "@grimoire/shared/types";

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
