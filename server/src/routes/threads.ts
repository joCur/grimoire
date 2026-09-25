// A chapter's open threads.
//
// The open threads are a LIST of the chapter (ADR #26, #29): rows
// `{ id, text, done }` in the chapter's order, answered as ThreadsResponse
// `{ entries, rev }` by every endpoint below. `rev` is the LIST's guard
// token (`chapters.threads_rev`). None of them reads or writes the chapter's
// text or moves the chapter's `rev` — a thread adopted in the review
// does not 409 an open chapter editor, and a text save does not invalidate
// the list. An unknown chapter is 404, an unsafe chapter id 400.

import { Hono } from "hono";
import type { PatchThreadRequest } from "@grimoire/shared";
import { ApiError } from "../api-error";
import { appendThread, deleteThread, patchThread, readThreads } from "../store/threads";
import { jsonBody, normalizeLineText, requireRev } from "./http";

export const threadRoutes = new Hono();

// GET /api/campaigns/:campaign/chapters/:chapter/threads -> ThreadsResponse
// The chapter's threads, in order. An EMPTY list answers 200 with no rows.
threadRoutes.get("/campaigns/:campaign/chapters/:chapter/threads", async (c) =>
  c.json(await readThreads(c.req.param("campaign"), c.req.param("chapter"))),
);

// POST /api/campaigns/:campaign/chapters/:chapter/threads { text } -> ThreadsResponse
// Appends ONE thread at the end of the list — the write behind
// adopting a plot thread in the review and behind adding a thread in
// the chapter overview. `text` is one line: trimmed, inner newlines folded to
// a space, empty is 400.
//
// NO `rev`, like POST /inbox and POST /log: an append adds a row nobody else
// can have edited, so it has nothing to overwrite, and a guard would refuse
// an adoption merely because the list moved in another tab. The list's token
// still moves, and the answer carries the fresh one.
threadRoutes.post("/campaigns/:campaign/chapters/:chapter/threads", async (c) => {
  const body = await jsonBody(c, ["text"]);
  const text = normalizeLineText(body.text);
  if (text === undefined) throw new ApiError(400, "text must be a non-empty string");
  return c.json(await appendThread(c.req.param("campaign"), c.req.param("chapter"), text));
});

// PATCH /api/campaigns/:campaign/chapters/:chapter/threads/:id { rev, text?, done? }
//   -> ThreadsResponse
// Ticks, unticks or rewords ONE thread, named by its row id. `done` is a
// boolean; `text` follows the append's one-line rule. Naming neither is
// 400 { code: "nothing_to_write" }.
//
// A stale `rev` is 409 { code: "rev_conflict", rev, threads } — the current
// list rides along under `threads`, the list's counterpart of an entry's
// `entry`. It is checked BEFORE the id, so a caller looking at an old list
// gets the new one; an id this chapter's list does not hold is 404, never a
// 200 that changed nothing. A patch that changes nothing writes nothing and
// the token stands.
threadRoutes.patch("/campaigns/:campaign/chapters/:chapter/threads/:id", async (c) => {
  const body = await jsonBody(c, ["rev", "text", "done"]);
  const request: PatchThreadRequest = { rev: requireRev(body.rev) };
  if (body.text !== undefined) {
    const text = normalizeLineText(body.text);
    if (text === undefined) throw new ApiError(400, "text must be a non-empty string");
    request.text = text;
  }
  if (body.done !== undefined) {
    if (typeof body.done !== "boolean") throw new ApiError(400, "done must be a boolean");
    request.done = body.done;
  }
  return c.json(
    await patchThread(c.req.param("campaign"), c.req.param("chapter"), c.req.param("id"), request),
  );
});

// DELETE /api/campaigns/:campaign/chapters/:chapter/threads/:id { rev } -> ThreadsResponse
// Removes ONE thread. The token travels in the body like on every other
// guarded write; the refusals are the patch's: 409 { code: "rev_conflict",
// rev, threads } for a stale list, then 404 for an id the list does not hold.
threadRoutes.delete("/campaigns/:campaign/chapters/:chapter/threads/:id", async (c) => {
  const body = await jsonBody(c, ["rev"]);
  return c.json(
    await deleteThread(
      c.req.param("campaign"),
      c.req.param("chapter"),
      c.req.param("id"),
      requireRev(body.rev),
    ),
  );
});
