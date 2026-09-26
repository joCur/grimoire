// The sessions: list, read, start, end and delete.
//
// A SESSION IS ITS OWN RESOURCE (decisions/resources): `…/sessions` and
// `…/sessions/:id`, answering the `Session` type — `{ id, started,
// startedMs?, ended?, endedMs?, body, pauses, log, playedScenes, rev }`. Its
// children are embedded when it is read, and each is written on its own
// resource under it: `…/sessions/:id/pauses` (./pauses.ts),
// `…/sessions/:id/log` (./log-entries.ts) and `…/sessions/:id/played-scenes`
// (./played-scenes.ts).
//
// TIME. Every zone-less timestamp carries the SERVER's epoch reading beside
// it (`startedMs`, `endedMs`, a pause's `fromMs`/`toMs`) — only the server
// knows which wall clock those digits belong to, so that is what makes the
// runtime correct in any timezone. A client computes with the epoch values
// and writes a moment as one; it never builds a wall-clock string.

import { Hono } from "hono";
import { ApiError } from "../api-error";
import {
  createSession,
  deleteSession,
  listSessions,
  patchSession,
  readSession,
  readSessionCreate,
  readSessionDelete,
  readSessionPatch,
  type RunningFilter,
} from "../store/sessions";
import { jsonBody } from "./http";

export const sessionRoutes = new Hono();

/** The `running` filter of the list: `true` or absent. */
function runningFilter(value: string | undefined): RunningFilter {
  if (value === undefined || value === "true") return value;
  throw new ApiError(400, "running must be true — or left out for every session");
}

// GET /api/campaigns/:campaign/sessions[?running=true] -> Session[]
// Every session of the campaign, NEWEST FIRST: by `started`, with the row's
// insertion time as the tie-break — several sessions a day are possible and
// the opaque id orders nothing. A session without a readable `started` stands
// last. The first of the list is therefore the last STARTED session, ended or
// not — the one the review harvests right after the evening, even when that
// evening ran past midnight and was ended in yesterday's session.
//
// `?running=true` answers the RUNNING session only: the last started one that
// is not ended, today's or an older one — a session that runs past midnight
// keeps running instead of vanishing at 00:00. It is a list of one or none;
// none is the ordinary state between two evenings, not an error. The app
// never derives the running session from its own date. Any other value of
// `running` is a 400.
sessionRoutes.get("/campaigns/:campaign/sessions", async (c) =>
  c.json(await listSessions(c.req.param("campaign"), runningFilter(c.req.query("running")))),
);

// GET /api/campaigns/:campaign/sessions/:id -> Session
// The session with its pauses, its log and its played scenes. 404 for an
// unknown campaign or session.
sessionRoutes.get("/campaigns/:campaign/sessions/:id", async (c) =>
  c.json(await readSession(c.req.param("campaign"), c.req.param("id"))),
);

// POST /api/campaigns/:campaign/sessions {} -> 201 Session | 200 Session
// Starts a session now, on the server's clock, with an opaque random id and
// no children. Ending is final, so a start after an ended session opens a
// new one, even on the same day. The body carries nothing; a key in it is a
// 400 that names it.
//
// While a session RUNS:
//   - one started TODAY — the calendar day of its `started` — comes back
//     unchanged with 200, so pressing "start" twice re-enters the evening;
//   - one of an EARLIER day is 409 { code: "session_running", id } and nothing
//     starts: the DM ends the older session first.
sessionRoutes.post("/campaigns/:campaign/sessions", async (c) => {
  readSessionCreate(await jsonBody(c, null));
  const { session, created } = await createSession(c.req.param("campaign"));
  return c.json(session, created ? 201 : 200);
});

// PATCH /api/campaigns/:campaign/sessions/:id
//   { rev, force?, id?, startedMs?, endedMs? } -> Session
// Ends the session (`endedMs`), lets it run again (`endedMs: null`) or
// corrects its start (`startedMs`). A moment is an EPOCH value: the server
// stores the reading of it in its own timezone. Ending closes an open pause
// at the same moment. The pauses, the log and the played scenes are not
// written here — each has its own resource.
//
// A key that is not one of these — `started`, `ended`, `pauses` among them —
// or a value of the wrong shape is a 400 that names it; naming no field is
// 400 { code: "nothing_to_write" }. The `id` may be echoed, never changed.
// A stale `rev` is 409 { code: "rev_conflict", rev, session } and writes
// nothing — `session` is the session as it stands now. `force: true` writes
// the given fields on top of it instead. 404 for an unknown campaign or
// session.
sessionRoutes.patch("/campaigns/:campaign/sessions/:id", async (c) => {
  const patch = readSessionPatch(await jsonBody(c, null));
  return c.json(await patchSession(c.req.param("campaign"), c.req.param("id"), patch));
});

// DELETE /api/campaigns/:campaign/sessions/:id { rev } -> 204
// The undo of a mis-clicked start. Only an EMPTY session may be deleted — no
// log entry, no played scene, a text of nothing but headings; one with
// content is 409 { code: "session_not_empty", id } and is ended, not deleted.
// A stale `rev` is 409 { code: "rev_conflict", rev, session }. Either refusal
// removes nothing. 404 for an unknown campaign or session.
sessionRoutes.delete("/campaigns/:campaign/sessions/:id", async (c) => {
  const request = readSessionDelete(await jsonBody(c, null));
  await deleteSession(c.req.param("campaign"), c.req.param("id"), request);
  return c.body(null, 204);
});
