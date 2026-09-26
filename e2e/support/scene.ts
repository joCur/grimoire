// A scene in the suite: its resource `…/scenes/:id` (decisions/resources), every field
// flat, `body` among them, beside its guard. Its type is the one
// `@grimoire/shared/scene` derives from the scene's schema.

import type { Scene, SceneChange } from "@grimoire/shared/scene";
import { exists, underCampaign, type Api } from "./api";

/** The request path of one scene, or, without an id, of the scene list. */
export function scenePath(api: Api, id?: string): string {
  return id === undefined ? underCampaign(api, "scenes") : underCampaign(api, "scenes", id);
}

/** GET one scene from its own resource; throws when it is unknown. */
export function getScene(api: Api, id: string): Promise<Scene> {
  return api.get<Scene>(scenePath(api, id));
}

/** Whether the campaign has a scene with that id (404 = no). */
export function sceneExists(api: Api, id: string): Promise<boolean> {
  return exists(api, scenePath(api, id));
}

/**
 * The ONE write of a scene: PATCH its resource with `rev` and any subset of
 * its fields, `body` among them. Omitted, `rev` is read first — the helper
 * then plays the second writer.
 */
export async function patchScene(
  api: Api,
  id: string,
  change: SceneChange & { rev?: number; force?: boolean },
): Promise<Scene> {
  const rev = change.rev ?? (await getScene(api, id)).rev;
  return api.send<Scene>("PATCH", scenePath(api, id), { ...change, rev });
}
