// The review action after a session: a log row reviewed. An idea the review
// ticks off is a PATCH of the idea (./ideas.ts), a thread it adopts is created
// on the thread's resource (./threads.ts), and an npc it makes out of a note
// on the npc's (./npcs.ts).

import { Hono } from "hono";
import { ApiError } from "../api-error";
import { markLogLineSeen } from "../store/sessions";
import { jsonBody } from "./http";

export const reviewRoutes = new Hono();

/** One id as sent by the review UI: a non-empty single-line string. */
function reviewId(v: unknown, what: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new ApiError(400, `${what} must be a non-empty string`);
  }
  if (v.includes("\n") || v.includes("\r")) {
    throw new ApiError(400, `${what} must be a single line`);
  }
  return v;
}

// POST /api/campaigns/:campaign/review/seen { sessionId, logId }
//   -> SessionResponse
// Marks ONE log row as reviewed. `reviewed` is a flag on the row, and `logId`
// is the row's own id — `SessionLogEntry.id`, which the review read out of the
// log it is showing.
//
// Idempotent: a row that already carries the flag comes back unchanged and
// nothing is written, so the session's `rev` stands. 404 when the campaign has
// no such session, and 404 when that session has no row with this id — the
// caller sends back an id it was given, so a miss is the session having moved
// on, which a 200 that changed nothing would hide.
reviewRoutes.post("/campaigns/:campaign/review/seen", async (c) => {
  const body = await jsonBody(c, ["sessionId", "logId"]);
  return c.json(
    await markLogLineSeen(
      c.req.param("campaign"),
      reviewId(body.sessionId, "sessionId"),
      reviewId(body.logId, "logId"),
    ),
  );
});
