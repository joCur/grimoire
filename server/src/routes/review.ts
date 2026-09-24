// The review actions after a session: a log row reviewed, an npc stub
// created, an idea ticked off.

import { Hono } from "hono";
import { ApiError } from "../api-error";
import { markInboxLineDone } from "../store/inbox";
import { createNpcStub } from "../store/npcs";
import { markLogLineSeen } from "../store/sessions";
import { jsonBody, normalizeLineText } from "./http";

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

// POST /api/campaigns/:campaign/review/npc-stub { id, name?, note? } -> EntryResponse
// Creates the npc entry (status: unknown) whose text is the note, no heading
// around it; without a note the text is empty — or, when the id already has
// one, answers with THAT entry: the caller's goal is "this id has an
// entry", so the call is idempotent. An entry that holds content is never
// overwritten; an EMPTY one — created and never filled in — is filled in.
reviewRoutes.post("/campaigns/:campaign/review/npc-stub", async (c) => {
  const body = await jsonBody(c, ["id", "name", "note"]);
  if (typeof body.id !== "string") throw new ApiError(400, "id must be a string");
  let name: string | undefined;
  if (body.name !== undefined && body.name !== null) {
    if (typeof body.name !== "string") throw new ApiError(400, "name must be a string");
    name = normalizeLineText(body.name); // empty after trim -> default (the id)
  }
  let note: string | undefined;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") throw new ApiError(400, "note must be a string");
    note = normalizeLineText(body.note); // empty after trim -> an empty text
  }
  return c.json(await createNpcStub(c.req.param("campaign"), body.id, name, note));
});

// POST /api/campaigns/:campaign/review/inbox-done { id } -> InboxResponse
// Ticks ONE idea off — the single documented exception to the inbox's
// append-only rule, so a harvested idea does not come back in every future
// review. `id` is the row's own id (`InboxEntry.id`).
//
// Idempotent: an idea already done comes back unchanged and the list's `rev`
// stands. 404 when the inbox has no row with that id.
reviewRoutes.post("/campaigns/:campaign/review/inbox-done", async (c) => {
  const body = await jsonBody(c, ["id"]);
  return c.json(await markInboxLineDone(c.req.param("campaign"), reviewId(body.id, "id")));
});
