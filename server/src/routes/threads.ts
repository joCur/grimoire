// The threads: list, read, create, write and delete.
//
// A THREAD IS ITS OWN RESOURCE (decisions/resources): `…/threads` and `…/threads/:id`,
// answering the `Thread` type — `{ id, chapter, text, done, rev }`. It lies
// flat under its campaign, and its chapter is a field: no thread write reads
// or moves the chapter's text or its `rev`, so a thread adopted in the review
// does not 409 an open chapter editor. Threads stand in the order they were
// created; there is no order to write.

import { Hono } from "hono";
import { ApiError } from "../api-error";
import {
  createThread,
  deleteThread,
  listThreads,
  patchThread,
  readThread,
  readThreadCreate,
  readThreadDelete,
  readThreadPatch,
} from "../store/threads";
import { jsonBody, normalizeLineText } from "./http";

export const threadRoutes = new Hono();

/** A thread's text is one line: trimmed, inner newlines folded; empty is a 400. */
function threadText(value: string): string {
  const text = normalizeLineText(value);
  if (text === undefined) throw new ApiError(400, "text must be a non-empty string");
  return text;
}

// GET /api/campaigns/:campaign/threads[?chapter=<id>] -> Thread[]
// The campaign's threads in the order they were created, or — with
// `?chapter=` — only those of that chapter. A chapter without threads answers
// an empty list, and so does a chapter that does not exist: a filter names no
// resource.
threadRoutes.get("/campaigns/:campaign/threads", async (c) =>
  c.json(await listThreads(c.req.param("campaign"), c.req.query("chapter"))),
);

// GET /api/campaigns/:campaign/threads/:id -> Thread
// `{ id, chapter, text, done, rev }`. 404 for an unknown campaign or thread.
threadRoutes.get("/campaigns/:campaign/threads/:id", async (c) =>
  c.json(await readThread(c.req.param("campaign"), c.req.param("id"))),
);

// POST /api/campaigns/:campaign/threads { chapter, text } -> 201 Thread
// A new open thread at the end — the write behind adopting a plot thread in
// the review and behind adding a thread in the chapter overview. The id is
// the server's. `text` is one line: trimmed, inner newlines folded to a
// space, empty is 400. A `chapter` the campaign does not have is 400 { code:
// "chapter_unknown" }; a key that is neither field, or a value of the wrong
// shape, is a 400 that names it.
//
// No `rev`: a new thread overwrites nothing.
threadRoutes.post("/campaigns/:campaign/threads", async (c) => {
  const request = readThreadCreate(await jsonBody(c, null));
  const thread = await createThread(c.req.param("campaign"), {
    chapter: request.chapter,
    text: threadText(request.text),
  });
  return c.json(thread, 201);
});

// PATCH /api/campaigns/:campaign/threads/:id
//   { rev, force?, id?, chapter?, text?, done? } -> Thread
// Ticks, unticks, rewords or moves ONE thread: any subset of its fields in
// one row update against its `rev`, checked against the thread's schema. A
// key that is not a field of a thread, or a value of the wrong shape, is a 400
// that names it; `text` follows the create's one-line rule; a `chapter` the
// campaign does not have is 400 { code: "chapter_unknown" }. Naming no field
// is 400 { code: "nothing_to_write" }. The `id` may be echoed, never changed.
//
// A stale `rev` is 409 { code: "rev_conflict", rev, thread } and writes
// nothing — `thread` is the thread as it stands now. `force: true` writes the
// given fields on top of it instead. 404 for an unknown campaign or thread.
threadRoutes.patch("/campaigns/:campaign/threads/:id", async (c) => {
  const patch = readThreadPatch(await jsonBody(c, null));
  return c.json(
    await patchThread(c.req.param("campaign"), c.req.param("id"), {
      ...patch,
      ...(patch.text === undefined ? {} : { text: threadText(patch.text) }),
    }),
  );
});

// DELETE /api/campaigns/:campaign/threads/:id { rev } -> 204
// Removes ONE thread. The guard travels in the body like on every other
// guarded write: a stale `rev` is 409 { code: "rev_conflict", rev, thread }
// and removes nothing. 404 for an unknown campaign or thread.
threadRoutes.delete("/campaigns/:campaign/threads/:id", async (c) => {
  const request = readThreadDelete(await jsonBody(c, null));
  await deleteThread(c.req.param("campaign"), c.req.param("id"), request);
  return c.body(null, 204);
});
