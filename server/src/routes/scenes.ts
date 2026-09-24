// The scenes: creating one inside its chapter.

import { Hono } from "hono";
import { createScene } from "../store/chapters";
import { jsonBody, optionalText, requiredText } from "./http";

export const sceneRoutes = new Hono();

// POST /api/campaigns/:campaign/scenes { title, chapter } -> 201 EntryResponse
// `chapter` is required and must exist (400) — a scene's chapter is part of
// its address, and chapters are never created by being named (ADR #19).
sceneRoutes.post("/campaigns/:campaign/scenes", async (c) => {
  const body = await jsonBody(c, ["title", "chapter", "id"]);
  const title = requiredText(body.title, "title");
  const chapter = requiredText(body.chapter, "chapter");
  return c.json(
    await createScene(c.req.param("campaign"), title, chapter, optionalText(body.id, "id")),
    201,
  );
});
