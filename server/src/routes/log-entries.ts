// The log of a session: take a note and review it.
//
// A LOG ENTRY IS ITS OWN RESOURCE (ADR #31), hanging under its session:
// `…/sessions/:session/log` and `…/sessions/:session/log/:id`, answering the
// `LogEntry` type — `{ id, at, sceneId?, text, reviewed, rev }`. The session
// embeds its log when it is read. The log is append-only: a note is written
// once, and the one change after that is the review's `reviewed`. No log
// write moves the session's `rev`.

import { Hono } from "hono";
import { ENTITY_SLUG } from "@grimoire/shared";
import { ApiError } from "../api-error";
import {
  createLogEntry,
  patchLogEntry,
  readLogEntryCreate,
  readLogEntryPatch,
} from "../store/log-entries";
import { jsonBody, normalizeLineText } from "./http";

export const logEntryRoutes = new Hono();

// POST /api/campaigns/:campaign/sessions/:session/log { text, sceneId? }
//   -> 201 LogEntry
// Takes one quick note: time (the server's clock, `HH:mm`), scene and text as
// columns, with an id the server hands out. The hashtags stay INSIDE `text`:
// they are body vocabulary (README), so the note is stored as the DM typed
// it — trimmed, inner newlines folded to a space; empty is 400.
//
// `sceneId` is a reference: a slug (400 otherwise) that has to name a scene
// of the campaign, 400 { code: "log_scene_unknown", value } when it does not.
// An empty `sceneId` is the same as none. A key that is neither field is a
// 400 that names it.
//
// 404 for an unknown campaign or session. An ended session takes no note —
// 409 { code: "session_ended", id } —, so a note typed after the end is
// refused instead of landing in a closed log.
logEntryRoutes.post("/campaigns/:campaign/sessions/:session/log", async (c) => {
  const request = readLogEntryCreate(await jsonBody(c, null));
  const text = normalizeLineText(request.text);
  if (text === undefined) throw new ApiError(400, "text must be a non-empty string");
  const sceneId = normalizeLineText(request.sceneId);
  if (sceneId !== undefined && !ENTITY_SLUG.test(sceneId)) {
    throw new ApiError(400, "sceneId must be a kebab-case slug (a-z, 0-9, single dashes)");
  }
  const entry = await createLogEntry(c.req.param("campaign"), c.req.param("session"), {
    text,
    ...(sceneId === undefined ? {} : { sceneId }),
  });
  return c.json(entry, 201);
});

// PATCH /api/campaigns/:campaign/sessions/:session/log/:id
//   { rev, force?, id?, reviewed? } -> LogEntry
// The review marks the note as seen (`reviewed: true`) or takes that back.
// Allowed on an ended session — the review comes after the evening. The note
// itself is written once: a key that is none of these — `text` among them —
// or a value of the wrong shape is a 400 that names it; naming no field is
// 400 { code: "nothing_to_write" }. The `id` may be echoed, never changed.
//
// A stale `rev` is 409 { code: "rev_conflict", rev, logEntry } and writes
// nothing; `force: true` writes on top of it instead. 404 for an unknown
// campaign, session or log entry.
logEntryRoutes.patch("/campaigns/:campaign/sessions/:session/log/:id", async (c) => {
  const patch = readLogEntryPatch(await jsonBody(c, null));
  return c.json(
    await patchLogEntry(c.req.param("campaign"), c.req.param("session"), c.req.param("id"), patch),
  );
});
