// The ideas: list, read, create and tick off.
//
// AN IDEA IS ITS OWN RESOURCE (ADR #31): `…/ideas` and `…/ideas/:id`,
// answering the `Idea` type — `{ id, text, done, rev }`. An idea is written
// once; the one change after that is ticking it off, a PATCH of its `done`.

import { Hono } from "hono";
import { ApiError } from "../api-error";
import { createIdea, listIdeas, patchIdea, readIdea, readIdeaCreate, readIdeaPatch } from "../store/ideas";
import { jsonBody, normalizeLineText } from "./http";

export const ideaRoutes = new Hono();

// GET /api/campaigns/:campaign/ideas -> Idea[]
// Every idea of the campaign in the order it was thrown in, done or not. No
// ideas answers an empty list (200), not a 404 — an empty list is a list.
ideaRoutes.get("/campaigns/:campaign/ideas", async (c) =>
  c.json(await listIdeas(c.req.param("campaign"))),
);

// GET /api/campaigns/:campaign/ideas/:id -> Idea
// `{ id, text, done, rev }`. 404 for an unknown campaign or idea.
ideaRoutes.get("/campaigns/:campaign/ideas/:id", async (c) =>
  c.json(await readIdea(c.req.param("campaign"), c.req.param("id"))),
);

// POST /api/campaigns/:campaign/ideas { text } -> 201 Idea
// A new open idea at the end — the mobile capture. The id is the server's.
// `text` is one line: trimmed, inner newlines folded to a space, empty is
// 400; any other key is a 400 that names it. No `rev`: a new idea overwrites
// nothing.
ideaRoutes.post("/campaigns/:campaign/ideas", async (c) => {
  const request = readIdeaCreate(await jsonBody(c, null));
  const text = normalizeLineText(request.text);
  if (text === undefined) throw new ApiError(400, "text must be a non-empty string");
  return c.json(await createIdea(c.req.param("campaign"), { text }), 201);
});

// PATCH /api/campaigns/:campaign/ideas/:id { rev, force?, id?, done } -> Idea
// Ticks ONE idea off — or back on — against its `rev`, so a harvested idea
// does not come back in every future review. `done` is the one field a patch
// carries: any other key, `text` among them, is a 400 that names it, and a
// patch without `done` is 400 { code: "nothing_to_write" }. The `id` may be
// echoed, never changed.
//
// A stale `rev` is 409 { code: "rev_conflict", rev, idea } and writes
// nothing — `idea` is the idea as it stands now. `force: true` writes on top
// of it instead. 404 for an unknown campaign or idea.
ideaRoutes.patch("/campaigns/:campaign/ideas/:id", async (c) => {
  const patch = readIdeaPatch(await jsonBody(c, null));
  return c.json(await patchIdea(c.req.param("campaign"), c.req.param("id"), patch));
});
