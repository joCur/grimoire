// Scene status: the labels/colors the chapter overview, the reading view and
// the session view share, the request of the status write, and the write
// itself (the rev conflict is the shared protocol in lib/write-with-rev.ts).
//
// The LABEL comes from the catalog, and the translator is PASSED IN — a pure
// helper never decides which language the UI is in (decisions/i18n).
// The colors stay here: they are design tokens, not copy.
//
// `scenes.status` is a CHECK constraint of its column, so the database cannot
// hold anything else (decisions/constraints) and the value is one of the four everywhere
// below — there is no foreign value to render.

import {
  SCENE_STATUSES,
  type Scene,
  type ScenePatch,
  type SceneStatus,
} from "@grimoire/shared/scene";

import type { MessageKey, Translate } from "@/i18n";
import { writeWithRev, type RevWriteResult } from "@/lib/write-with-rev";

import { fetchScene, patchScene } from "./scene-api";

/** Catalog key + dot/text colors per design/README.md. */
const SCENE_STATUS_META: Record<
  SceneStatus,
  { key: MessageKey; dot: string; text: string }
> = {
  ready: { key: "status.scene.ready", dot: "bg-success", text: "text-success-text" },
  draft: { key: "status.scene.draft", dot: "bg-muted-foreground", text: "text-dim" },
  played: { key: "status.scene.played", dot: "bg-faint", text: "text-muted-foreground" },
  dropped: { key: "status.scene.dropped", dot: "bg-faint", text: "text-muted-foreground" },
};

/** Label + colors for a status value. */
export function sceneStatusMeta(
  status: SceneStatus,
  t: Translate,
): { label: string; dot: string; text: string } {
  const { key, dot, text } = SCENE_STATUS_META[status];
  return { label: t(key), dot, text };
}

/**
 * The four selectable options — SCENE_STATUSES from @grimoire/shared/scene is
 * the single source (and already in lifecycle order: draft → ready → played →
 * dropped), so a format change lands here without a second list. A FUNCTION
 * rather than a constant: the labels depend on the UI language, so they cannot
 * be a module constant evaluated once at import time.
 */
export function sceneStatusOptions(
  t: Translate,
): ReadonlyArray<{ value: SceneStatus; label: string }> {
  return SCENE_STATUSES.map((value) => ({ value, label: t(SCENE_STATUS_META[value].key) }));
}

/**
 * Statuses that take a scene out of the evening's plan: `played` and
 * `dropped`. The live nav groups these away; the other two count as still
 * planned.
 */
const DONE_STATUSES: ReadonlySet<SceneStatus> = new Set<SceneStatus>(["played", "dropped"]);

/** True when the scene's status says it is behind us (played or dropped). */
export function isSceneDone(status: SceneStatus): boolean {
  return DONE_STATUSES.has(status);
}

/** Request of the status write — the rev comes from the scene on screen. */
export function sceneStatusPatchBody(rev: number, status: SceneStatus): ScenePatch {
  return { rev, status };
}

/**
 * Write the scene's `status`. The 409 handling — nothing written, re-read
 * once so the next attempt carries the fresh rev — is the shared protocol of
 * lib/write-with-rev.ts. Every other failure throws.
 */
export function writeSceneStatus(
  campaign: string,
  id: string,
  rev: number,
  status: SceneStatus,
): Promise<RevWriteResult<Scene>> {
  return writeWithRev(
    () => patchScene(campaign, id, sceneStatusPatchBody(rev, status)),
    () => fetchScene(campaign, id),
  );
}
