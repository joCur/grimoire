// Scene status (issue #28): the German labels/colors the pool and the reading
// view share, the patch payload for PATCH /frontmatter, and the write flow
// including the mtime conflict.
//
// Degrade rule (README): an unknown status value is shown VERBATIM — the file
// stays the truth. The menu only ever offers the known quartet, and picking
// one replaces whatever stood there.

import { SCENE_STATUSES, type FileResponse, type SceneStatus } from "@grimoire/shared/types";

import { ApiError, fetchFile, patchFrontmatter } from "@/api";

/** German labels + dot/text colors per design/README.md ("bereit · Entwurf · gespielt"). */
const SCENE_STATUS_META: Record<SceneStatus, { label: string; dot: string; text: string }> = {
  ready: { label: "bereit", dot: "bg-success", text: "text-success-text" },
  draft: { label: "Entwurf", dot: "bg-muted-foreground", text: "text-dim" },
  played: { label: "gespielt", dot: "bg-faint", text: "text-muted-foreground" },
  dropped: { label: "verworfen", dot: "bg-faint", text: "text-muted-foreground" },
};

function knownStatus(status: string): SceneStatus | undefined {
  return (SCENE_STATUSES as readonly string[]).includes(status)
    ? (status as SceneStatus)
    : undefined;
}

/** Label + colors for a status value; unknown values keep their raw label. */
export function sceneStatusMeta(status: string): { label: string; dot: string; text: string } {
  const known = knownStatus(status);
  if (known !== undefined) return SCENE_STATUS_META[known];
  return { label: status, dot: "bg-muted-foreground", text: "text-dim" };
}

/**
 * The four selectable options — SCENE_STATUSES from @grimoire/shared is the
 * single source (and already in lifecycle order: draft → ready → played →
 * dropped), so a format change lands here without a second list.
 */
export const SCENE_STATUS_OPTIONS: ReadonlyArray<{ value: SceneStatus; label: string }> =
  SCENE_STATUSES.map((value) => ({ value, label: SCENE_STATUS_META[value].label }));

/** Body of the status write — the mtime comes from the FileResponse on screen. */
export interface FrontmatterPatchBody {
  path: string;
  mtimeMs: number;
  patch: Record<string, unknown>;
}

/** Builds the PATCH /frontmatter payload for one status change. */
export function sceneStatusPatchBody(
  path: string,
  mtimeMs: number,
  status: SceneStatus,
): FrontmatterPatchBody {
  return { path, mtimeMs, patch: { status } };
}

/** True for the server's mtime conflict (409) — the file changed on disk. */
export function isStaleFileError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

/** Shown inline (no toast) after a conflict; the next attempt uses the fresh mtime. */
export const STALE_FILE_MESSAGE = "Datei extern geändert — neu laden";

export type SceneStatusWriteResult =
  /** Written: the server's fresh file, ready to seed into the query cache. */
  | { ok: true; file: FileResponse }
  /**
   * NOT written — the file changed on disk. `file` is the re-read file when
   * the reload succeeded (its mtime makes the next attempt work); undefined
   * when even the reload failed.
   */
  | { ok: false; file?: FileResponse };

/**
 * Write `status` into the file's frontmatter. On a 409 nothing was written:
 * the file is re-read so the view shows the current state and the next
 * attempt carries the fresh mtime. Every other failure throws.
 */
export async function writeSceneStatus(
  campaign: string,
  path: string,
  mtimeMs: number,
  status: SceneStatus,
): Promise<SceneStatusWriteResult> {
  try {
    const file = await patchFrontmatter(campaign, sceneStatusPatchBody(path, mtimeMs, status));
    return { ok: true, file };
  } catch (error) {
    if (!isStaleFileError(error)) throw error;
    try {
      return { ok: false, file: await fetchFile(campaign, path) };
    } catch {
      // The reload failed too (server gone): the conflict message stands,
      // the cache keeps the stale file and the normal queries retry.
      return { ok: false };
    }
  }
}
