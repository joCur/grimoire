// Scene status (issue #28): the German labels/colors the pool and the reading
// view share, the patch payload for PATCH /properties, and the write itself
// (the rev conflict is the shared protocol in write-with-rev.ts).
//
// Degrade rule (README): an unknown status value is shown VERBATIM — the file
// stays the truth. The menu only ever offers the known quartet, and picking
// one replaces whatever stood there.

import { SCENE_STATUSES, type SceneStatus } from "@grimoire/shared/types";

import { fetchFile, patchProperties } from "@/api";
import { writeWithRev, type RevWriteResult } from "@/lib/write-with-rev";

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

/** Body of the status write — the rev comes from the FileResponse on screen. */
export interface PropertiesPatchBody {
  path: string;
  rev: number;
  patch: Record<string, unknown>;
}

/** Builds the PATCH /properties payload for one status change. */
export function sceneStatusPatchBody(
  path: string,
  rev: number,
  status: SceneStatus,
): PropertiesPatchBody {
  return { path, rev, patch: { status } };
}

/**
 * Write `status` into the file's properties. The 409 handling — nothing
 * written, re-read once so the next attempt carries the fresh rev — is the
 * shared protocol of write-with-rev.ts. Every other failure throws.
 */
export function writeSceneStatus(
  campaign: string,
  path: string,
  rev: number,
  status: SceneStatus,
): Promise<RevWriteResult> {
  return writeWithRev(
    () => patchProperties(campaign, sceneStatusPatchBody(path, rev, status)),
    () => fetchFile(campaign, path),
  );
}
