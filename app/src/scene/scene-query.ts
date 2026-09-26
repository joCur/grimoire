// The query of a scene: the key of one scene — its reading view, the session
// view's center column, its preview, its drawer and its status control share
// it, so a scene one of them read is not asked for again — and the key of the
// scenes in the trash. Their first segments are what the campaign's version
// poll invalidates.

import type { QueryKey } from "@tanstack/react-query";

import { fetchScene, fetchTrashedScenes } from "./scene-api";

const ONE = "scene";
const TRASH = "scene-trash";

/** The first segment of every scene query key — one scene, and the trash. */
export const SCENE_QUERY_ROOTS = [ONE, TRASH] as const;

/** The query key of one scene. */
export function sceneKey(campaign: string, id: string): QueryKey {
  return [ONE, campaign, id];
}

/** Key and fetch of one scene, for `useQuery` and `prefetchQuery` alike. */
export function sceneQuery(campaign: string, id: string) {
  return { queryKey: sceneKey(campaign, id), queryFn: () => fetchScene(campaign, id) };
}

/** The query key of the campaign's scenes in the trash. */
export function sceneTrashKey(campaign: string): QueryKey {
  return [TRASH, campaign];
}

/** Key and fetch of the campaign's scenes in the trash. */
export function sceneTrashQuery(campaign: string) {
  return { queryKey: sceneTrashKey(campaign), queryFn: () => fetchTrashedScenes(campaign) };
}
