// The chapters: create one, make one the active chapter, and write the order
// of its scenes.

import { Hono } from "hono";
import { ApiError } from "../api-error";
import { createChapter, setActiveChapter, writeSceneOrder } from "../store/chapters";
import { jsonBody, optionalText, requiredText, requireRev } from "./http";

export const chapterRoutes = new Hono();

// POST /api/campaigns/:campaign/chapters { title, description?, id? } -> 201 EntryResponse
// `description` becomes the chapter's text as typed (trimmed, one closing
// newline, no heading around it); the chapter overview shows that text under
// the title. Without it the text stays empty.
chapterRoutes.post("/campaigns/:campaign/chapters", async (c) => {
  const body = await jsonBody(c, ["title", "description", "id"]);
  const title = requiredText(body.title, "title");
  const description = optionalText(body.description, "description");
  return c.json(
    await createChapter(c.req.param("campaign"), title, description, optionalText(body.id, "id")),
    201,
  );
});

// POST /api/campaigns/:campaign/chapters/:id/active -> EntryResponse of that chapter
// The active state in the chapter overview's status control: the chapter becomes
// `active` and the one that was active goes back to `planned`, in ONE
// transaction — two calls from the app would leave a window with two active
// chapters, and the session view picks the first it finds. Idempotent, 404
// for an unknown chapter, no rev guard (store/chapters.ts explains why).
chapterRoutes.post("/campaigns/:campaign/chapters/:id/active", async (c) =>
  c.json(await setActiveChapter(c.req.param("campaign"), c.req.param("id"))),
);

// PUT /api/campaigns/:campaign/chapters/:chapter/scene-order { scenes, rev }
//   -> { scenes, rev }
// The order of the scenes INSIDE one chapter, written as a whole — the
// glossary's contract applied to a chapter: the array IS the order, and
// there is no per-scene "move", because moving one scene changes where its
// neighbours sit too.
//
// `rev` is the ORDER's own guard token (`ChapterNode.sceneOrderRev`), and the
// answer carries the fresh one — not the chapter entry's `rev`, which guards
// its properties and text and does not move here (ADR #27). A stale one is
// 409 { code: "rev_conflict", rev } and writes nothing. No `entry` rides
// along — the order is not one, and the overview reloads the tree.
//
// `scenes` must name EXACTLY the scenes of the chapter. A missing, a foreign
// or a repeated id is
// 400 { code: "scene_order_mismatch", missing, unknown, duplicate } and
// nothing is written — a partial order would have to invent positions for
// the scenes it leaves out.
//
// The scenes' own `rev` does NOT move (store/chapters.ts says why): a scene's
// guard covers its properties and its text, and reordering the chapter
// around an open scene editor must not turn that editor into a conflict.
chapterRoutes.put("/campaigns/:campaign/chapters/:chapter/scene-order", async (c) => {
  const body = await jsonBody(c, ["scenes", "rev"]);
  const raw = body.scenes;
  if (!Array.isArray(raw)) throw new ApiError(400, "scenes must be an array");
  const order = raw.map((id) => {
    if (typeof id !== "string" || id.trim() === "") {
      throw new ApiError(400, "each scene must be a non-empty id");
    }
    return id.trim();
  });
  return c.json(
    await writeSceneOrder(
      c.req.param("campaign"),
      c.req.param("chapter"),
      order,
      requireRev(body.rev),
    ),
  );
});
