// Log entries: the log entry resource.
//
// A log entry is its own resource with its own type (ADR #31,
// @grimoire/shared/log-entry), hanging under its session: taken and reviewed
// here, typed by its one zod schema. The log is append-only — a note is
// written once, as COLUMNS (time, scene, text), and the one change after that
// is the review's `reviewed`. Every entry carries its own guard `rev`, and no
// entry write moves the session's.

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { format } from "date-fns";
import {
  logEntryCreateSchema,
  logEntryPatchSchema,
  type LogEntry,
  type LogEntryCreate,
  type LogEntryPatch,
  type LogEntrySeed,
} from "@grimoire/shared/log-entry";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { logEntries } from "../db/schema";
import { mutate } from "./campaigns";
import { assertSceneRef } from "./scenes";
import { requireRunningSessionRow, requireSessionRow } from "./session-rows";
import { nextPos, parseRequest, revConflict } from "./shared";

/** One stored log entry row. */
type LogEntryRow = typeof logEntries.$inferSelect;

/** `HH:mm` in the server's local time — the time a note carries. */
const LOCAL_TIME = "HH:mm";

// --- rendering and reading ----------------------------------------------------

/**
 * The log entry of a row. The hashtags stay INSIDE `text`: they are body
 * vocabulary (README), so the note travels as the DM typed it.
 */
function renderLogEntry(row: LogEntryRow): LogEntry {
  return {
    id: row.id,
    at: row.at ?? "",
    ...(row.sceneId === null ? {} : { sceneId: row.sceneId }),
    text: row.text,
    reviewed: row.reviewed !== 0,
    rev: row.rev,
  };
}

function logEntryRowsOf(db: GrimoireDb, campaign: string, sessionId: string): LogEntryRow[] {
  return db
    .select()
    .from(logEntries)
    .where(and(eq(logEntries.campaignId, campaign), eq(logEntries.sessionId, sessionId)))
    .orderBy(asc(logEntries.pos), asc(logEntries.id))
    .all();
}

/** The log of a session in the order it was written — what the session embeds. */
export function sessionLog(db: GrimoireDb, campaign: string, sessionId: string): LogEntry[] {
  return logEntryRowsOf(db, campaign, sessionId).map(renderLogEntry);
}

/** The log entry with this id in this session; 404 when it has none. */
function requireLogEntryRow(
  db: GrimoireDb,
  campaign: string,
  sessionId: string,
  id: string,
): LogEntryRow {
  const row = db
    .select()
    .from(logEntries)
    .where(
      and(
        eq(logEntries.campaignId, campaign),
        eq(logEntries.sessionId, sessionId),
        eq(logEntries.id, id),
      ),
    )
    .all()[0];
  if (row === undefined) throw new ApiError(404, "log entry not found");
  return row;
}

// --- writing ------------------------------------------------------------------

/** The body of a log entry POST, checked against the entry's create form. */
export function readLogEntryCreate(raw: unknown): LogEntryCreate {
  return parseRequest(logEntryCreateSchema, raw, "log entry");
}

/**
 * POST /api/campaigns/:campaign/sessions/:session/log `{ text, sceneId? }` —
 * append one note to the session's log, with the time on the server's clock
 * and an id the server hands out. The session has to run (404 for an unknown
 * one, 409 `session_ended` for an ended one): a note typed after the end is
 * refused instead of landing in a closed log.
 *
 * The note's scene is a reference: it has to name a scene that exists
 * (400 `log_scene_unknown`), and nothing is created for it. `text` arrives as
 * one trimmed line and `sceneId` as a slug (the route checks both).
 */
export async function createLogEntry(
  campaign: string,
  sessionId: string,
  request: LogEntryCreate,
): Promise<LogEntry> {
  return mutate(campaign, (tx) => {
    requireRunningSessionRow(tx, campaign, sessionId);
    const sceneId = request.sceneId ?? null;
    if (sceneId !== null) assertSceneRef(tx, campaign, sceneId);
    const at = format(new Date(), LOCAL_TIME);
    const id = randomUUID();
    tx.insert(logEntries)
      .values({
        campaignId: campaign,
        sessionId,
        id,
        at,
        sceneId,
        text: request.text,
        reviewed: 0,
        pos: nextPos(logEntryRowsOf(tx, campaign, sessionId)),
      })
      .run();
    return renderLogEntry(requireLogEntryRow(tx, campaign, sessionId, id));
  });
}

/**
 * The body of a log entry PATCH, checked against the entry's schema: the
 * guard, `force` and `reviewed` — a key that is none of these, or a value of
 * the wrong shape, is a 400 that names it.
 */
export function readLogEntryPatch(raw: unknown): LogEntryPatch {
  return parseRequest(logEntryPatchSchema, raw, "log entry patch");
}

/**
 * PATCH /api/campaigns/:campaign/sessions/:session/log/:id `{ rev, reviewed }`
 * — the review marks the note as seen, or takes that back. The session may be
 * ended: the review comes after the evening. A patch that names no field is
 * 400 `nothing_to_write`; the id may be echoed, never changed.
 *
 * A stale `rev` is 409 with the current entry under `logEntry`; `force`
 * writes on top of it instead. An unknown session or entry is 404.
 */
export async function patchLogEntry(
  campaign: string,
  sessionId: string,
  id: string,
  patch: LogEntryPatch,
): Promise<LogEntry> {
  const { rev, force, id: patchedId, reviewed } = patch;
  if (reviewed === undefined && patchedId === undefined) {
    throw new ApiError(400, "nothing to write — send reviewed", { code: "nothing_to_write" });
  }
  return mutate(campaign, (tx) => {
    requireSessionRow(tx, campaign, sessionId);
    const row = requireLogEntryRow(tx, campaign, sessionId, id);
    const guard = force === true ? row.rev : rev;
    if (row.rev !== guard) {
      throw revConflict(row.rev, "log entry changed", { logEntry: renderLogEntry(row) });
    }
    if (patchedId !== undefined && patchedId !== row.id) {
      throw new ApiError(400, "id is the primary key — it is set at creation and never changes");
    }
    const next: LogEntryRow = {
      ...row,
      reviewed: reviewed === undefined ? row.reviewed : reviewed ? 1 : 0,
      rev: row.rev + 1,
    };
    tx.update(logEntries)
      .set({ reviewed: next.reviewed, rev: next.rev })
      .where(
        and(
          eq(logEntries.campaignId, campaign),
          eq(logEntries.sessionId, sessionId),
          eq(logEntries.id, id),
        ),
      )
      .run();
    return renderLogEntry(next);
  });
}

// --- the seed -----------------------------------------------------------------

/**
 * Write one log entry of a session fixture, after the ones before it, INSIDE
 * the caller's transaction. Its scene is a foreign key, so a fixture naming a
 * scene the campaign does not have is refused by the database.
 */
export function insertLogEntrySeed(
  tx: GrimoireDb,
  campaign: string,
  sessionId: string,
  seed: LogEntrySeed,
): void {
  const at = seed.at === "" ? null : seed.at;
  const sceneId = seed.sceneId ?? null;
  tx.insert(logEntries)
    .values({
      campaignId: campaign,
      sessionId,
      id: seed.id,
      at,
      sceneId,
      text: seed.text,
      reviewed: seed.reviewed ? 1 : 0,
      pos: nextPos(logEntryRowsOf(tx, campaign, sessionId)),
    })
    .run();
}
