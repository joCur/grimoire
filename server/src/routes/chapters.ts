// The chapters: list, read, create, write, and the order of a chapter's
// scenes.
//
// A CHAPTER IS ITS OWN RESOURCE (ADR #31): `…/chapters` and `…/chapters/:id`,
// answering the `Chapter` type — every field of the chapter flat, `body`
// among them, beside its `rev`. Which chapter is the active one is its
// `status`: a write that makes a chapter `active` puts the one that held it
// back to `planned`, in the same transaction. The order of a chapter's scenes
// and its open threads are no fields of it: each has its own endpoint and its
// own guard (below, and ./threads.ts).

import { Hono } from "hono";
import { ApiError } from "../api-error";
import {
  createChapter,
  listChapters,
  patchChapter,
  readChapter,
  readChapterCreate,
  writeSceneOrder,
} from "../store/chapters";
import { jsonBody, optionalText, requiredText, requireRev } from "./http";

export const chapterRoutes = new Hono();

// GET /api/campaigns/:campaign/chapters -> Chapter[] — every chapter of the
// campaign in the campaign's order, each exactly as its own GET answers it.
chapterRoutes.get("/campaigns/:campaign/chapters", async (c) =>
  c.json(await listChapters(c.req.param("campaign"))),
);

// GET /api/campaigns/:campaign/chapters/:id -> Chapter
// `{ id, title, status?, body, rev }` — every field of the chapter flat, the
// status absent when the chapter carries none, and `rev` the guard its PATCH
// sends back. 404 for an unknown campaign or chapter.
chapterRoutes.get("/campaigns/:campaign/chapters/:id", async (c) =>
  c.json(await readChapter(c.req.param("campaign"), c.req.param("id"))),
);

// POST /api/campaigns/:campaign/chapters { title, id?, status?, body? } -> 201 Chapter
// The id is derived from `title` unless the request sets it. The chapter
// starts at `status` — `planned` when the request names none — and goes to
// the end of the campaign. `status: "active"` makes it THE active chapter:
// the chapter that was active goes back to `planned` in the same
// transaction, and its `rev` moves. `body` becomes the chapter's text as
// typed (trimmed, one closing newline, no heading around it); the chapter
// overview shows that text under the title. A taken id is 409 { code:
// "slug_taken", kind, id, suggestion } and writes nothing. A `status` outside
// the three is 400 { code: "status_not_allowed" }; a key that is none of the
// four, or a value of the wrong shape, is a 400 that names it.
chapterRoutes.post("/campaigns/:campaign/chapters", async (c) => {
  const request = readChapterCreate(await jsonBody(c, null));
  const title = requiredText(request.title, "title");
  const id = optionalText(request.id, "id");
  return c.json(
    await createChapter(c.req.param("campaign"), {
      title,
      ...(id === undefined ? {} : { id }),
      ...(request.status === undefined ? {} : { status: request.status }),
      ...(request.body === undefined ? {} : { body: request.body }),
    }),
    201,
  );
});

// PATCH /api/campaigns/:campaign/chapters/:id
//   { rev, force?, id?, title?, status?, body? } -> Chapter
// THE write of one chapter (ADR #23): any subset of its fields — `body` is
// one of them — in ONE row update against ONE `rev`, checked against the
// chapter's schema. `null` clears the status; a key that is not a field of a
// chapter, or a value of the wrong shape, is a 400 that names it, and a
// `status` outside the three is 400 { code: "status_not_allowed" }. A
// request that names no field is 400 { code: "nothing_to_write" }. The `id`
// may be echoed, never changed (400).
//
// `status: "active"` makes the chapter THE active one: at most one chapter
// per campaign is active, so the chapter that was active goes back to
// `planned` in the same transaction, and its `rev` moves with it.
//
// A stale `rev` is 409 { code: "rev_conflict", rev, chapter } and writes
// nothing — `chapter` is the chapter as it stands now. `force: true` writes
// the given fields on top of that current row instead: only what this request
// carries is written, so a field changed in between survives a forced save of
// the text. Neither the scene order's guard nor the thread list's moves.
// 404 for an unknown campaign or chapter.
chapterRoutes.patch("/campaigns/:campaign/chapters/:id", async (c) => {
  const body = await jsonBody(c, null);
  return c.json(await patchChapter(c.req.param("campaign"), c.req.param("id"), body));
});

// PUT /api/campaigns/:campaign/chapters/:chapter/scene-order { scenes, rev }
//   -> { scenes, rev }
// The order of the scenes INSIDE one chapter, written as a whole — the
// glossary's contract applied to a chapter: the array IS the order, and
// there is no per-scene "move", because moving one scene changes where its
// neighbours sit too.
//
// `rev` is the ORDER's own guard token (`ChapterNode.sceneOrderRev`), and the
// answer carries the fresh one — not the chapter's `rev`, which guards its
// fields and does not move here (ADR #27). A stale one is 409 { code:
// "rev_conflict", rev } and writes nothing. No chapter rides along — the
// order is none of its fields, and the overview reloads the tree.
//
// `scenes` must name EXACTLY the scenes of the chapter. A missing, a foreign
// or a repeated id is
// 400 { code: "scene_order_mismatch", missing, unknown, duplicate } and
// nothing is written — a partial order would have to invent positions for
// the scenes it leaves out.
//
// The scenes' own `rev` does NOT move (store/chapters.ts says why): a scene's
// guard covers its fields, and reordering the chapter around an open scene
// editor must not turn that editor into a conflict.
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
