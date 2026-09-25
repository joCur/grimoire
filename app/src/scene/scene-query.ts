// The query of a scene: the key of one scene — its reading view, the session
// view's center column, its preview, its drawer and its status control share
// it, so a scene one of them read is not asked for again. Its first segment is
// what the campaign's version poll invalidates.

import type { QueryKey } from "@tanstack/react-query";

import { fetchScene } from "./scene-api";

const ONE = "scene";

/** The first segment of every scene query key. */
export const SCENE_QUERY_ROOTS = [ONE] as const;

/** The query key of one scene. */
export function sceneKey(campaign: string, id: string): QueryKey {
  return [ONE, campaign, id];
}

/** Key and fetch of one scene, for `useQuery` and `prefetchQuery` alike. */
export function sceneQuery(campaign: string, id: string) {
  return { queryKey: sceneKey(campaign, id), queryFn: () => fetchScene(campaign, id) };
}
