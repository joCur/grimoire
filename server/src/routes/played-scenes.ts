// The played scenes of a session: the next step of the evening.
//
// A PLAYED SCENE IS ITS OWN RESOURCE (ADR #31), hanging under its session:
// `…/sessions/:session/played-scenes`, answering the `PlayedScene` type —
// `{ id, sceneId, rev }`. The session embeds its played scenes, in the order
// of play, when it is read; a scene the group returns to later stands there
// twice. No played scene write moves the session's `rev`.

import { Hono } from "hono";
import { createPlayedScene, readPlayedSceneCreate } from "../store/played-scenes";
import { jsonBody } from "./http";

export const playedSceneRoutes = new Hono();

// POST /api/campaigns/:campaign/sessions/:session/played-scenes { sceneId }
//   -> 201 PlayedScene
// "Next scene": the session reaches `sceneId`, which stands at the end of its
// played scenes, with an id the server hands out. The scene is a reference:
// one the campaign does not have is 400 { code: "played_scene_unknown",
// value }, and nothing is created for it. A key that is not `sceneId`, or a
// value of the wrong shape, is a 400 that names it.
//
// 404 for an unknown campaign or session. An ended session takes no next
// scene: 409 { code: "session_ended", id }.
playedSceneRoutes.post("/campaigns/:campaign/sessions/:session/played-scenes", async (c) => {
  const request = readPlayedSceneCreate(await jsonBody(c, null));
  const played = await createPlayedScene(c.req.param("campaign"), c.req.param("session"), request);
  return c.json(played, 201);
});
