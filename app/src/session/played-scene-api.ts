// The API client of a played scene (ADR #31): its resource under its
// session. The played scenes of a session are the sequence of scenes the
// group played that evening.

import type { PlayedScene } from "@grimoire/shared/played-scene";

import { postJson } from "@/api";

import { sessionsUrl } from "./session-api";

/**
 * Record `sceneId` as played in the session; it stands at the end of the
 * sequence. An ended session takes no played scene: 409 `session_ended`.
 */
export function createPlayedScene(
  campaign: string,
  sessionId: string,
  sceneId: string,
): Promise<PlayedScene> {
  return postJson<PlayedScene>(`${sessionsUrl(campaign, sessionId)}/played-scenes`, { sceneId });
}
