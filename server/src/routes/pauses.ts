// The pauses of a session: begin and end.
//
// A PAUSE IS ITS OWN RESOURCE (decisions/resources), hanging under its session:
// `…/sessions/:session/pauses` and `…/sessions/:session/pauses/:id`,
// answering the `Pause` type — `{ id, from, fromMs?, to?, toMs?, rev }`. The
// session embeds its pauses when it is read. A pause is an interval of the
// session's clock and nothing else: it writes no log entry, and no pause
// write moves the session's `rev`.

import { Hono } from "hono";
import { createPause, patchPause, readPauseCreate, readPausePatch } from "../store/pauses";
import { jsonBody } from "./http";

export const pauseRoutes = new Hono();

// POST /api/campaigns/:campaign/sessions/:session/pauses {} -> 201 Pause | 200 Pause
// Begins a pause now, on the server's clock: the session's clock stands until
// the pause ends. A session has at most one open pause — while one is open,
// it comes back unchanged with 200. The body carries nothing; a key in it is
// a 400 that names it.
//
// 404 for an unknown campaign or session. An ended session takes no pause:
// 409 { code: "session_ended", id }.
pauseRoutes.post("/campaigns/:campaign/sessions/:session/pauses", async (c) => {
  readPauseCreate(await jsonBody(c, null));
  const { pause, created } = await createPause(c.req.param("campaign"), c.req.param("session"));
  return c.json(pause, created ? 201 : 200);
});

// PATCH /api/campaigns/:campaign/sessions/:session/pauses/:id
//   { rev, force?, id?, fromMs?, toMs? } -> Pause
// Ends the pause (`toMs`) or corrects either end. A moment is an EPOCH value:
// the server stores the reading of it in its own timezone. Allowed on an
// ended session too — correcting a pause is part of looking back.
//
// A key that is not one of these — `from` and `to` among them — or a value of
// the wrong shape is a 400 that names it; naming no field is 400 { code:
// "nothing_to_write" }. The `id` may be echoed, never changed. A stale `rev`
// is 409 { code: "rev_conflict", rev, pause } and writes nothing; `force:
// true` writes the given fields on top of it instead. 404 for an unknown
// campaign, session or pause.
pauseRoutes.patch("/campaigns/:campaign/sessions/:session/pauses/:id", async (c) => {
  const patch = readPausePatch(await jsonBody(c, null));
  return c.json(
    await patchPause(c.req.param("campaign"), c.req.param("session"), c.req.param("id"), patch),
  );
});
