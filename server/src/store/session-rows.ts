// The session row: how it is found, which one runs, and the order of two.
//
// The session's own module (./sessions.ts) and the modules of its children
// (./pauses.ts, ./log-entries.ts, ./played-scenes.ts) all look up the session
// a request names, and the campaign list (./campaigns.ts) orders the sessions
// of a campaign the way the session list does — so these statements stand
// here once, and nothing here renders or writes.

import { and, eq } from "drizzle-orm";
import { isSessionEnded } from "@grimoire/shared/session";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { sessions } from "../db/schema";
import { localDateTimeToMs } from "./time";

/** One stored session row. */
export type SessionRow = typeof sessions.$inferSelect;

/** The session with this id, or undefined when the campaign has none. */
export function sessionRowOf(db: GrimoireDb, campaign: string, id: string): SessionRow | undefined {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.campaignId, campaign), eq(sessions.id, id)))
    .all()[0];
}

/** The session with this id; 404 when the campaign has none. */
export function requireSessionRow(db: GrimoireDb, campaign: string, id: string): SessionRow {
  const row = sessionRowOf(db, campaign, id);
  if (row === undefined) throw new ApiError(404, "session not found");
  return row;
}

/**
 * The session with this id, which has to be RUNNING: a log entry, a pause or
 * a played scene belongs to the evening that is still going on. 404 when the
 * campaign has no such session, 409 `session_ended` when it is ended — the
 * session exists, it just takes nothing new.
 */
export function requireRunningSessionRow(db: GrimoireDb, campaign: string, id: string): SessionRow {
  const row = requireSessionRow(db, campaign, id);
  if (isSessionEnded(row)) {
    throw new ApiError(409, "this session is ended — it takes nothing new", {
      code: "session_ended",
      id: row.id,
    });
  }
  return row;
}

// --- the chronological order of two sessions ---------------------------------

/** The only three session columns the ordering rule below looks at. */
export type SessionOrderFields = Pick<SessionRow, "id" | "started" | "createdAt">;

/**
 * Chronological order key of a session in epoch milliseconds, or undefined
 * when the row says nothing usable about WHEN it started.
 *
 * `started` is the ONLY source. The id is an opaque random string and there
 * is nothing in it to read, so a row without a usable `started` wins nothing.
 *
 * Takes only the column it reads, so callers that need nothing else of a
 * session (the campaign list) can select just those.
 */
export function sessionOrderKey(row: Pick<SessionOrderFields, "started">): number | undefined {
  return localDateTimeToMs(row.started);
}

/**
 * Newest-first comparator: `started` decides, and `createdAt` — the row's
 * insertion time in milliseconds — breaks the tie. Two sessions of the same
 * evening can share a `started` to the SECOND (start, end, start again), and
 * "the last started one" has to be the second of them, deterministically.
 * The opaque id cannot say which came first, so the row records it.
 *
 * Last resort for two rows that share both (a seeded row carries `createdAt`
 * 0): a plain string compare of the ids. Which of them then counts as newer
 * is arbitrary — but it is STABLE, and that is the property callers need.
 *
 * A row without a usable `started` sorts behind every row that has one.
 */
export function compareSessionsNewestFirst(
  a: SessionOrderFields,
  b: SessionOrderFields,
): number {
  const ka = sessionOrderKey(a) ?? -Infinity;
  const kb = sessionOrderKey(b) ?? -Infinity;
  if (ka !== kb) return kb - ka;
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Every session row of a campaign, NEWEST FIRST. */
export function sessionRowsNewestFirst(db: GrimoireDb, campaign: string): SessionRow[] {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.campaignId, campaign))
    .all()
    .sort(compareSessionsNewestFirst);
}

/**
 * The RUNNING session row: the last STARTED one that is not ended — today's
 * or an older one, so a session that runs past midnight stays the running
 * one instead of vanishing at 00:00. A row without a usable `started` has no
 * place in the chronology and is never the running session.
 *
 * This is the one place that decides what "the running session" is; a client
 * never derives it from its own date.
 */
export function runningSessionRow(db: GrimoireDb, campaign: string): SessionRow | undefined {
  return sessionRowsNewestFirst(db, campaign).find(
    (row) => sessionOrderKey(row) !== undefined && !isSessionEnded(row),
  );
}
