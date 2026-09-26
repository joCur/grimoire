// The scenes of a session: the ones its notes were taken in.
//
// Whether a scene was PLAYED is the scene's status alone; a session records no
// scenes of its own. What the session knows is where the DM took notes — that
// is the sign a scene came up that evening. The live view's played box
// starts ticked in such a scene, and the reading page of a past evening lists
// those scenes.
//
// Pure on purpose — the views and their tests agree on these functions.

import type { Session } from "@grimoire/shared/session";

/** Whether the session holds a note taken in `sceneId`. */
export function hasNoteInScene(session: Pick<Session, "log">, sceneId: string): boolean {
  return session.log.some((entry) => entry.sceneId === sceneId);
}

/** The scenes the session's notes were taken in, each once, in the order of its first note. */
export function scenesWithNotes(session: Pick<Session, "log">): string[] {
  const ids = session.log.flatMap((entry) => (entry.sceneId === undefined ? [] : [entry.sceneId]));
  return [...new Set(ids)];
}
