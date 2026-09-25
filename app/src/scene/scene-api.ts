// The API client of a scene (ADR #31): its resource — read, create, write —
// its write conflict, and the augment run on it. Built from the shared HTTP
// helpers (../api.ts).

import type {
  GenerateJobStarted,
  Scene,
  SceneCreate,
  ScenePatch,
} from "@grimoire/shared/types";

import {
  ApiError,
  campaignPath,
  getJson,
  postJson,
  runTexts,
  sendJson,
  startJob,
} from "@/api";

/** The request path of a campaign's scenes, or of one of them. */
function scenesUrl(campaign: string, id?: string): string {
  const base = `${campaignPath(campaign)}/scenes`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

/** One scene — every field flat, `body` among them, beside its `rev`. */
export function fetchScene(campaign: string, id: string): Promise<Scene> {
  return getJson<Scene>(scenesUrl(campaign, id));
}

/**
 * The one write of a scene: any subset of its fields — `body` is one of
 * them, `null` clears `trigger` or `location` — against the `rev` the editing
 * session started from. A stale `rev` is 409 with the current scene
 * (`sceneConflict`); `force` writes the given fields on top of it. A new
 * `chapter` moves the scene to the end of that chapter.
 */
export function patchScene(campaign: string, id: string, request: ScenePatch): Promise<Scene> {
  return sendJson<Scene>("PATCH", scenesUrl(campaign, id), request);
}

/** The server's scene at the moment it refused a write. */
export interface SceneConflict {
  /** The scene's current version — what a retry would have to carry. */
  rev: number;
  /** The current scene; undefined when the 409 body did not carry one. */
  scene?: Scene;
}

/**
 * Read a scene write conflict out of a rejection: the 409 of the scene PATCH
 * (and of accepting an augment proposal), with the version and the scene the
 * server answered with. `undefined` for anything else. A 409 whose body is
 * shaped differently still counts as a conflict, just without the details.
 */
export function sceneConflict(error: unknown): SceneConflict | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  const { rev, scene } = error.details;
  return {
    rev: typeof rev === "number" ? rev : Number.NaN,
    ...(isScene(scene) ? { scene } : {}),
  };
}

function isScene(value: unknown): value is Scene {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<Scene>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.body === "string" &&
    typeof candidate.rev === "number"
  );
}

/**
 * A new scene in an EXISTING chapter (the server answers 400 for an unknown
 * one), at the end of it, as a draft — answered as the scene itself.
 */
export function createScene(campaign: string, input: SceneCreate): Promise<Scene> {
  return postJson<Scene>(scenesUrl(campaign), {
    title: input.title,
    chapter: input.chapter,
    ...(input.id === undefined ? {} : { id: input.id }),
  });
}

/**
 * Start an augment run on a scene, on the scene's own resource — the same
 * job model as every other run (`startJob`); the proposal is fetched via
 * fetchGenerateJob (`kind: "scene-augment"`, `sceneAugmentResult`).
 */
export function startSceneAugmentJob(
  campaign: string,
  id: string,
  input: { sourceText?: string; instruction?: string },
): Promise<GenerateJobStarted> {
  return startJob(`${scenesUrl(campaign, id)}/augment`, runTexts(input));
}

/**
 * Accept a reviewed scene proposal: the fields the DM took and the body
 * assembled from the accepted blocks — the scene's PATCH without `force` —
 * written in ONE transaction against `rev`; `jobId` discards the job in the
 * same transaction. A 409 is the scene conflict (`sceneConflict`).
 */
export function applySceneAugment(
  campaign: string,
  id: string,
  input: Omit<ScenePatch, "force" | "id"> & { jobId?: string },
): Promise<Scene> {
  return postJson<Scene>(`${scenesUrl(campaign, id)}/augment/apply`, input);
}
