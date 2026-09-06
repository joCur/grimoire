// Scene status (issue #28): the German labels/colors the pool and the reading
// view share, the patch payload for PATCH /frontmatter, and the write itself
// (the mtime conflict is the shared protocol in write-with-mtime.ts).
//
// Degrade rule (README): an unknown status value is shown VERBATIM — the file
// stays the truth. The menu only ever offers the known quartet, and picking
// one replaces whatever stood there.

import { SCENE_STATUSES, type SceneStatus } from "@grimoire/shared/types";

import { fetchFile, patchFrontmatter } from "@/api";
import { writeWithMtime, type MtimeWriteResult } from "@/lib/write-with-mtime";

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

/**
 * Statuses that take a scene out of the evening's plan: `played` ("gespielt")
 * and `dropped` ("verworfen"). The live nav groups these away (issue #73);
 * everything else — including an unknown value, which degrades to plain text —
 * counts as still planned.
 */
const DONE_STATUSES: ReadonlySet<string> = new Set<SceneStatus>(["played", "dropped"]);

/** True when the scene's status says it is behind us (played or dropped). */
export function isSceneDone(status: string): boolean {
  return DONE_STATUSES.has(status);
}

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

/**
 * Write `status` into the file's frontmatter. The 409 handling — nothing
 * written, re-read once so the next attempt carries the fresh mtime — is the
 * shared protocol of write-with-mtime.ts. Every other failure throws.
 */
export function writeSceneStatus(
  campaign: string,
  path: string,
  mtimeMs: number,
  status: SceneStatus,
): Promise<MtimeWriteResult> {
  return writeWithMtime(
    () => patchFrontmatter(campaign, sceneStatusPatchBody(path, mtimeMs, status)),
    () => fetchFile(campaign, path),
  );
}
