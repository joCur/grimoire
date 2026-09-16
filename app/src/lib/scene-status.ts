// Scene status (issue #28): the labels/colors the pool and the reading view
// share, the patch payload for PATCH /properties, and the write itself (the
// rev conflict is the shared protocol in write-with-rev.ts).
//
// The LABEL comes from the catalog since issue #69, and the translator is
// PASSED IN — this module must not decide which language the UI is in
// (CLAUDE.md/i18n/index.ts: the lib layer takes `Translate` as a parameter).
// The colors stay here: they are design tokens, not copy.
//
// Degrade rule (README): an unknown status value is shown VERBATIM — the entry
// stays the truth. The menu only ever offers the known quartet, and picking
// one replaces whatever stood there.

import { SCENE_STATUSES, type SceneStatus } from "@grimoire/shared/types";

import { fetchEntry, patchProperties } from "@/api";
import type { MessageKey, Translate } from "@/i18n";
import { writeWithRev, type RevWriteResult } from "@/lib/write-with-rev";

/** Catalog key + dot/text colors per design/README.md ("Bereit · Entwurf · Gespielt"). */
const SCENE_STATUS_META: Record<
  SceneStatus,
  { key: MessageKey; dot: string; text: string }
> = {
  ready: { key: "status.scene.ready", dot: "bg-success", text: "text-success-text" },
  draft: { key: "status.scene.draft", dot: "bg-muted-foreground", text: "text-dim" },
  played: { key: "status.scene.played", dot: "bg-faint", text: "text-muted-foreground" },
  dropped: { key: "status.scene.dropped", dot: "bg-faint", text: "text-muted-foreground" },
};

function knownStatus(status: string): SceneStatus | undefined {
  return (SCENE_STATUSES as readonly string[]).includes(status)
    ? (status as SceneStatus)
    : undefined;
}

/** Label + colors for a status value; unknown values keep their raw label. */
export function sceneStatusMeta(
  status: string,
  t: Translate,
): { label: string; dot: string; text: string } {
  const known = knownStatus(status);
  if (known !== undefined) {
    const { key, dot, text } = SCENE_STATUS_META[known];
    return { label: t(key), dot, text };
  }
  return { label: status, dot: "bg-muted-foreground", text: "text-dim" };
}

/**
 * The four selectable options — SCENE_STATUSES from @grimoire/shared is the
 * single source (and already in lifecycle order: draft → ready → played →
 * dropped), so a format change lands here without a second list. A FUNCTION
 * since issue #69: the labels depend on the UI language, so they cannot be a
 * module constant evaluated once at import time.
 */
export function sceneStatusOptions(
  t: Translate,
): ReadonlyArray<{ value: SceneStatus; label: string }> {
  return SCENE_STATUSES.map((value) => ({ value, label: t(SCENE_STATUS_META[value].key) }));
}

/**
 * Statuses that take a scene out of the evening's plan: `played` ("Gespielt")
 * and `dropped` ("Verworfen"). The live nav groups these away (issue #73);
 * everything else — including an unknown value, which degrades to plain text —
 * counts as still planned.
 */
const DONE_STATUSES: ReadonlySet<string> = new Set<SceneStatus>(["played", "dropped"]);

/** True when the scene's status says it is behind us (played or dropped). */
export function isSceneDone(status: string): boolean {
  return DONE_STATUSES.has(status);
}

/** Body of the status write — the rev comes from the EntryResponse on screen. */
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
 * Write `status` into the entry's properties. The 409 handling — nothing
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
    () => fetchEntry(campaign, path),
  );
}
