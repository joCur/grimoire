// A PLAYED SCENE — one step of a session through the scenes of its chapter —
// its one zod schema and the forms derived from it (decisions/resources).
//
// `playedSceneSchema` is the played scene as the session embeds it and as
// `POST /api/campaigns/:c/sessions/:s/played-scenes` answers it. The
// TypeScript type, the POST the resource accepts and the played scene a
// fixture holds are each derived from it below with zod's own API.
//
// A played scene hangs UNDER its session. The played scenes of a session are
// a sequence in the order they were played: a scene the group returns to
// later stands in it twice.

import { z } from "zod";

/**
 * A played scene, exactly as the resource answers it: `id` its stable key —
 * an opaque id the server hands out —, `sceneId` the scene that was played,
 * and `rev` its row version.
 */
export const playedSceneSchema = z.strictObject({
  id: z.string(),
  sceneId: z.string(),
  rev: z.number(),
});

export type PlayedScene = z.infer<typeof playedSceneSchema>;

/**
 * A played scene without its guard: what a session fixture embeds
 * (`fixtures/<campaign>/sessions/<id>.json`) and the seed writes.
 */
export const playedSceneSeedSchema = playedSceneSchema.omit({ rev: true });

export type PlayedSceneSeed = z.infer<typeof playedSceneSeedSchema>;

/**
 * The body of `POST /api/campaigns/:c/sessions/:s/played-scenes`: the scene
 * that was played. It stands at the end of the sequence.
 */
export const playedSceneCreateSchema = playedSceneSeedSchema.pick({ sceneId: true });

export type PlayedSceneCreate = z.infer<typeof playedSceneCreateSchema>;
