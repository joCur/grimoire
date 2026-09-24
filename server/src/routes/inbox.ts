// The inbox: the DM's ideas, read as a list and appended to one at a time.

import { Hono } from "hono";
import { ApiError } from "../api-error";
import { appendInboxEntry, readInbox } from "../store/inbox";
import { jsonBody, normalizeLineText } from "./http";

export const inboxRoutes = new Hono();

// GET /api/campaigns/:campaign/inbox -> InboxResponse `{ entries, rev }` —
// the ideas as rows (`{ id, text, done }`), newest last: the inbox is
// append-only. An EMPTY inbox answers 200 with an empty list, not a 404 — an
// empty list is a list, and a 404 would make every reader special-case an
// answer that means nothing is wrong.
//
// `rev` is the LIST's guard token (`campaigns.inbox_rev`), not
// `campaigns.version`: every unrelated write bumps that one, and one log line
// would then invalidate an inbox the DM had open during a session.
inboxRoutes.get("/campaigns/:campaign/inbox", async (c) =>
  c.json(await readInbox(c.req.param("campaign"))),
);

// POST /api/campaigns/:campaign/inbox { text } -> InboxResponse
// Appends one idea as a row and answers the WHOLE list with its fresh `rev`.
// No heading row is written in front of the first idea: the inbox is a table
// and has no skeleton (ADR #26).
inboxRoutes.post("/campaigns/:campaign/inbox", async (c) => {
  const body = await jsonBody(c, ["text"]);
  const text = normalizeLineText(body.text);
  if (text === undefined) throw new ApiError(400, "text must be a non-empty string");
  return c.json(await appendInboxEntry(c.req.param("campaign"), text));
});
