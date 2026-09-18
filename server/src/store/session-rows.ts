// The rows behind a session, and how they become a `SessionResponse`.
//
// A session is a row plus three lists — its pauses, its log and the scenes it
// played. Reading them, picking the ACTIVE one out of a campaign, appending a
// log row, closing an open pause and stepping the session's guard token are
// all the same handful of statements, and every endpoint in ./sessions.ts is
// built from them.

import { and, asc, eq } from "drizzle-orm";
import { isEnded, type SessionResponse, type SessionSummary } from "@grimoire/shared";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { logEntries, sessionPauses, sessionScenesPlayed, sessions } from "../db/schema";
import { logLineId } from "./body-parse";
import {
  renderSession,
  sessionSummary,
  type LogRow,
  type PauseRow,
  type SessionRow,
} from "./render";
import { compareSessionsNewestFirst, nextPos, sessionOrderKey } from "./shared";

// --- the three lists of a session ---------------------------------------------

export function playedScenes(db: GrimoireDb, campaign: string, sessionId: string): string[] {
  return db
    .select({ sceneId: sessionScenesPlayed.sceneId })
    .from(sessionScenesPlayed)
    .where(
      and(
        eq(sessionScenesPlayed.campaignId, campaign),
        eq(sessionScenesPlayed.sessionId, sessionId),
      ),
    )
    .orderBy(asc(sessionScenesPlayed.pos))
    .all()
    .map((r) => r.sceneId);
}

export function pauseRows(db: GrimoireDb, campaign: string, sessionId: string): PauseRow[] {
  return db
    .select({
      pos: sessionPauses.pos,
      fromTs: sessionPauses.fromTs,
      toTs: sessionPauses.toTs,
    })
    .from(sessionPauses)
    .where(and(eq(sessionPauses.campaignId, campaign), eq(sessionPauses.sessionId, sessionId)))
    .orderBy(asc(sessionPauses.pos))
    .all() as PauseRow[];
}

export function logRows(db: GrimoireDb, campaign: string, sessionId: string): LogRow[] {
  return db
    .select({
      pos: logEntries.pos,
      at: logEntries.at,
      sceneId: logEntries.sceneId,
      text: logEntries.text,
      hash: logEntries.hash,
      reviewed: logEntries.reviewed,
    })
    .from(logEntries)
    .where(and(eq(logEntries.campaignId, campaign), eq(logEntries.sessionId, sessionId)))
    .orderBy(asc(logEntries.pos))
    .all() as LogRow[];
}

// --- the session row ----------------------------------------------------------

export function sessionRow(
  db: GrimoireDb,
  campaign: string,
  id: string,
): SessionRow | undefined {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.campaignId, campaign), eq(sessions.id, id)))
    .all()[0] as SessionRow | undefined;
}

function pickLatest(rows: SessionRow[]): SessionRow | undefined {
  const candidates = rows.filter((row) => sessionOrderKey(row) !== undefined);
  if (candidates.length === 0) return undefined;
  return [...candidates].sort(compareSessionsNewestFirst)[0];
}

/**
 * The ACTIVE session row: the last STARTED one that is not ended. With
 * `includeEnded` it is simply the last started session — the row the review
 * harvests, which may be yesterday's when the evening ran past midnight.
 */
export function pickSession(
  db: GrimoireDb,
  campaign: string,
  includeEnded: boolean,
): SessionRow | undefined {
  const rows = db
    .select()
    .from(sessions)
    .where(eq(sessions.campaignId, campaign))
    .all() as SessionRow[];
  const candidates = includeEnded ? rows : rows.filter((r) => !isEnded({ ended: r.ended }));
  return pickLatest(candidates);
}

export function renderSessionRow(
  db: GrimoireDb,
  campaign: string,
  row: SessionRow,
): SessionResponse {
  return renderSession(
    row,
    pauseRows(db, campaign, row.id),
    logRows(db, campaign, row.id),
    playedScenes(db, campaign, row.id),
  );
}

/** Every session of a campaign as a list head, NEWEST FIRST. */
export function sessionSummaries(db: GrimoireDb, campaign: string): SessionSummary[] {
  return (
    db.select().from(sessions).where(eq(sessions.campaignId, campaign)).all() as SessionRow[]
  )
    .sort(compareSessionsNewestFirst)
    .map(sessionSummary);
}

// --- the statements every endpoint shares -------------------------------------

export function requireActive(tx: GrimoireDb, campaign: string): SessionRow {
  const row = pickSession(tx, campaign, false);
  if (row === undefined) throw new ApiError(404, "no active session");
  return row;
}

export function bumpSessionRev(tx: GrimoireDb, campaign: string, row: SessionRow): void {
  tx.update(sessions)
    .set({ rev: row.rev + 1 })
    .where(and(eq(sessions.campaignId, campaign), eq(sessions.id, row.id)))
    .run();
}

export function closeOpenPauses(
  tx: GrimoireDb,
  campaign: string,
  sessionId: string,
  to: string,
): boolean {
  const open = pauseRows(tx, campaign, sessionId).filter((p) => p.toTs === null);
  if (open.length === 0) return false;
  for (const pause of open) {
    tx.update(sessionPauses)
      .set({ toTs: to })
      .where(
        and(
          eq(sessionPauses.campaignId, campaign),
          eq(sessionPauses.sessionId, sessionId),
          eq(sessionPauses.pos, pause.pos),
        ),
      )
      .run();
  }
  return true;
}

/**
 * Append one log row (append-only: existing rows are never rewritten).
 *
 * The row is written as COLUMNS — time, scene, text — and its id is the hash
 * of the canonical line those columns spell (./body-parse). Nothing composes
 * a markdown line to store, and nothing parses one back: a note that begins
 * with "(…)" is text like any other, and the scene a note MEANS arrives as
 * this function's own `sceneId`, checked by the caller.
 */
export function appendLogRow(
  tx: GrimoireDb,
  campaign: string,
  sessionId: string,
  at: string,
  sceneId: string | null,
  text: string,
): void {
  const rows = logRows(tx, campaign, sessionId);
  tx.insert(logEntries)
    .values({
      campaignId: campaign,
      sessionId,
      pos: nextPos(rows),
      at,
      sceneId,
      text,
      hash: logLineId(at, sceneId, text),
      reviewed: 0,
    })
    .run();
}
