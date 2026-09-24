// The sessions: the active one, the list of past evenings, the session verbs,
// the hand-corrected timestamps and the log.

import { Hono } from "hono";
import type { PatchSessionRequest } from "@grimoire/shared";
import { ApiError } from "../api-error";
import {
  appendLogEntry,
  continueSession,
  discardSession,
  endSession,
  listSessions,
  patchSession,
  pauseSession,
  readActiveSession,
  readSession,
  startSession,
} from "../store/sessions";
import { isPlainObject, jsonBody, normalizeLineText, requireRev } from "./http";

export const sessionRoutes = new Hono();

/** Query flag: present and not `0`/`false` counts as on (`?includeEnded=1`). */
function isTruthyFlag(v: string | undefined): boolean {
  return v !== undefined && v !== "0" && v.toLowerCase() !== "false";
}

// GET /api/campaigns/:campaign/session -> SessionResponse | null — the ACTIVE
// session, `null` when none runs. "Active" = the last STARTED session without
// `ended` — today's or an older one, so a session that runs past midnight
// stays active instead of vanishing at 00:00.
//
// This is the one place that decides what "the running session" is: the app
// must never derive it from its own date (a browser in another timezone, or
// simply a session past midnight, would get it wrong).
//
// `null` and not a 404: between two evenings nothing runs, and that is the
// ordinary state of a campaign, not a missing thing.
//
// The answer is ROWS, not an entry (ADR #26): `log` is the list of log rows,
// `pauses` the intervals, `scenesPlayed` the sequence. Every zone-less
// timestamp carries the SERVER's epoch reading beside it (`startedMs`,
// `endedMs`, a pause's `fromMs`/`toMs`) — that is what makes the live runtime
// correct in any timezone, and the client does plain epoch arithmetic: it
// subtracts the closed intervals and freezes the clock on the open one.
//
// `?includeEnded=1` asks the OTHER question: the last STARTED session, ended
// or not. That is the review's session (the harvest runs right after the session
// is ended), and it must come from the server for the same reason — a session
// that ran past midnight was ended in YESTERDAY's row, so the client's own
// date would harvest an empty or wrong one.
sessionRoutes.get("/campaigns/:campaign/session", async (c) =>
  c.json(await readActiveSession(c.req.param("campaign"), isTruthyFlag(c.req.query("includeEnded")))),
);

// GET /api/campaigns/:campaign/sessions -> SessionSummary[] — every session,
// NEWEST FIRST. A summary is the identifying head of a session: its id and
// when it ran, with the epoch readings. No log and no played scenes — a list
// shows when the evening was, and the session itself has the rest.
//
// The order is `started`, with the row's insertion time as the tie-break:
// several sessions per day are possible and the opaque id orders nothing.
sessionRoutes.get("/campaigns/:campaign/sessions", async (c) =>
  c.json(await listSessions(c.req.param("campaign"))),
);

// GET /api/campaigns/:campaign/sessions/:id -> SessionResponse, 404 for an
// unknown id. The way to read a session that is NOT the active one — the
// review's list of past evenings opens them through this.
sessionRoutes.get("/campaigns/:campaign/sessions/:id", async (c) =>
  c.json(await readSession(c.req.param("campaign"), c.req.param("id"))),
);

// POST /api/campaigns/:campaign/session/start -> SessionResponse
// Creates a NEW session with an OPAQUE RANDOM id (ending one is FINAL, so a
// second evening on the same day is simply a second session with its own
// empty log and a runtime starting at 0; nothing reads the id — order and
// every label come from `started`). Idempotent only while TODAY's session is
// the RUNNING one — "today" is the date part of its `started` — so pressing
// the button twice re-enters it.
// One 409:
//   { code: "session_running", id } — an OLDER session is still open (past
//     midnight, or never ended). The app offers to end that one; nothing
//     starts a second parallel session.
sessionRoutes.post("/campaigns/:campaign/session/start", async (c) =>
  c.json(await startSession(c.req.param("campaign"))),
);

// POST /api/campaigns/:campaign/session/end -> SessionResponse — ends the
// ACTIVE session (that may be yesterday's row when it ran past midnight). An
// open pause is closed by the end. Idempotent — with nothing running the LAST
// STARTED session comes back with its existing `ended`; 404 when the campaign
// has no session at all.
sessionRoutes.post("/campaigns/:campaign/session/end", async (c) => c.json(await endSession(c.req.param("campaign"))));

// POST /api/campaigns/:campaign/session/pause -> SessionResponse — really
// STOPS the clock: it opens a `{ from }` interval in `pauses` and nothing
// else. No log row is written for it — a pause IS that interval, and the
// `— Pause` line the log used to carry was the same pause a second time
// (ADR #26). Idempotent (already paused -> 200, unchanged); 404 when no
// session is running.
sessionRoutes.post("/campaigns/:campaign/session/pause", async (c) =>
  c.json(await pauseSession(c.req.param("campaign"))),
);

// POST /api/campaigns/:campaign/session/continue -> SessionResponse — closes
// the open pause interval (`to`). It ends a PAUSE, not a session (an ended
// session is never re-opened), and writes no log row either. Idempotent (not
// paused -> 200, unchanged); 404 when no session is running.
sessionRoutes.post("/campaigns/:campaign/session/continue", async (c) =>
  c.json(await continueSession(c.req.param("campaign"))),
);

// POST /api/campaigns/:campaign/session/discard -> { id } — DELETES the
// active session, the undo of a mis-clicked session start. Allowed ONLY
// while that session is empty (no log row, no played scene); otherwise 409
// { code: "session_not_empty", id } — a session with content is ended, never
// deleted. 404 when nothing is running.
sessionRoutes.post("/campaigns/:campaign/session/discard", async (c) =>
  c.json(await discardSession(c.req.param("campaign"))),
);

// PATCH /api/campaigns/:campaign/sessions/:id { rev, started?, ended?,
//   pauses? } -> SessionResponse
// The TIMESTAMPS of a session — everything about it the DM corrects by hand:
// a start typed into the wrong hour, a pause that was never closed. A field
// left out keeps its value, `ended: null` clears it (the session runs again)
// and `pauses` replaces the whole list.
//
// The log and `scenesPlayed` are NOT patchable: they grow through POST /log
// and the review actions, and a whole-list write of an append-only log is not
// an edit anybody asked for. Naming none of the three fields is 400
// { code: "nothing_to_write" }.
//
// 400 { code: "timestamp_not_allowed", field, value } for a value outside
// `yyyy-mm-ddTHH:MM:SS` — checked for the WHOLE request before the first
// write, so a refusal refuses all of it. 404 for an unknown id. A stale `rev`
// is 409 { code: "rev_conflict", rev, session } — the current session rides
// along, so the conflict dialog shows what is in the way without a second
// request. The key is `session`, not `entry`: a session is not an entry.
sessionRoutes.patch("/campaigns/:campaign/sessions/:id", async (c) => {
  const body = await jsonBody(c, ["rev", "started", "ended", "pauses"]);
  const request: PatchSessionRequest = { rev: requireRev(body.rev) };
  if (body.started !== undefined) {
    if (typeof body.started !== "string") throw new ApiError(400, "started must be a string");
    request.started = body.started;
  }
  if (body.ended !== undefined) {
    if (body.ended !== null && typeof body.ended !== "string") {
      throw new ApiError(400, "ended must be a string or null");
    }
    request.ended = body.ended;
  }
  if (body.pauses !== undefined) {
    if (!Array.isArray(body.pauses)) throw new ApiError(400, "pauses must be an array");
    request.pauses = body.pauses.map((item) => {
      if (!isPlainObject(item)) throw new ApiError(400, "each pause must be an object");
      if (typeof item.from !== "string") throw new ApiError(400, "each pause needs a `from`");
      if (item.to !== undefined && item.to !== null && typeof item.to !== "string") {
        throw new ApiError(400, "a pause's `to` must be a string or null");
      }
      return { from: item.from, ...(item.to === undefined ? {} : { to: item.to }) };
    });
  }
  return c.json(await patchSession(c.req.param("campaign"), c.req.param("id"), request));
});

// POST /api/campaigns/:campaign/log { text, sceneId? } -> SessionResponse
// Appends one log ROW — time, scene and text as columns — to the ACTIVE
// session (not stubbornly to today's); 404 when no session is running,
// including right after the session was ended, where a note would otherwise land
// in a closed log. With a `sceneId` the scene is also appended to
// `scenesPlayed`, in the same transaction; an unknown one is 400
// { code: "log_scene_unknown", value }.
//
// The hashtags stay INSIDE `text`: they are body vocabulary (README), so the
// note is stored as the DM typed it.
sessionRoutes.post("/campaigns/:campaign/log", async (c) => {
  const body = await jsonBody(c, ["text", "sceneId"]);
  const text = normalizeLineText(body.text);
  if (text === undefined) throw new ApiError(400, "text must be a non-empty string");
  let sceneId: string | undefined;
  if (body.sceneId !== undefined && body.sceneId !== null) {
    if (typeof body.sceneId !== "string") throw new ApiError(400, "sceneId must be a string");
    sceneId = normalizeLineText(body.sceneId);
  }
  return c.json(await appendLogEntry(c.req.param("campaign"), text, sceneId));
});
