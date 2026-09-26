// When a scene counts as played in a session.
//
// A scene is played when the DM LEAVES it with "Nächste Szene" — and only when
// the session holds at least one note taken in it: without a note there is no
// sign the group played it, so nothing is recorded and the DM marks the scene
// later. A note alone records nothing, and ending the session records nothing
// either: the scene open at the end may carry on next time. A scene is
// recorded once per session.
//
// Pure on purpose — the live view and its tests agree on this one function.

import type { Session } from "@grimoire/shared/session";

/** The ids of the scenes the session recorded as played. */
export function playedSceneIds(session: Pick<Session, "playedScenes">): string[] {
  return session.playedScenes.map((played) => played.sceneId);
}

/** Whether leaving `sceneId` with "Nächste Szene" records it as played. */
export function leavesScenePlayed(
  session: Pick<Session, "log" | "playedScenes">,
  sceneId: string,
): boolean {
  return (
    session.log.some((entry) => entry.sceneId === sceneId) &&
    !session.playedScenes.some((played) => played.sceneId === sceneId)
  );
}
