// Pauses: the pause resource.
//
// A pause is its own resource with its own type (ADR #31,
// @grimoire/shared/pause), hanging under its session: begun, ended and
// corrected here, typed by its one zod schema. Every pause carries its own
// guard `rev`, and no pause write moves the session's. A session has at most
// one open pause, and a pause writes no log entry: the interval is the pause.
//
// The two ends are zone-less wall-clock strings (store/time.ts): a new one is
// the server's clock, and a moment from the wire arrives as an epoch value
// the server reads into that shape in its own timezone.

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { format } from "date-fns";
import {
  pauseCreateSchema,
  pausePatchSchema,
  type Pause,
  type PauseCreate,
  type PausePatch,
  type PauseSeed,
} from "@grimoire/shared/pause";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { pauses } from "../db/schema";
import { mutate } from "./campaigns";
import { requireRunningSessionRow, requireSessionRow } from "./session-rows";
import { nextPos, parseRequest, revConflict } from "./shared";
import { LOCAL_DATE_TIME_SECONDS, epochToLocalDateTime, localDateTimeToMs } from "./time";

/** One stored pause row. */
type PauseRow = typeof pauses.$inferSelect;

// --- rendering and reading ----------------------------------------------------

/**
 * The pause of a row: both ends with the server's epoch reading beside them.
 * An end the server cannot read contributes no reading.
 */
function renderPause(row: PauseRow): Pause {
  const fromMs = localDateTimeToMs(row.fromTs);
  const toMs = localDateTimeToMs(row.toTs);
  return {
    id: row.id,
    from: row.fromTs,
    ...(fromMs === undefined ? {} : { fromMs }),
    ...(row.toTs === null ? {} : { to: row.toTs }),
    ...(toMs === undefined ? {} : { toMs }),
    rev: row.rev,
  };
}

function pauseRowsOf(db: GrimoireDb, campaign: string, sessionId: string): PauseRow[] {
  return db
    .select()
    .from(pauses)
    .where(and(eq(pauses.campaignId, campaign), eq(pauses.sessionId, sessionId)))
    .orderBy(asc(pauses.pos), asc(pauses.id))
    .all();
}

/** The pauses of a session in the order they began — what the session embeds. */
export function sessionPauses(db: GrimoireDb, campaign: string, sessionId: string): Pause[] {
  return pauseRowsOf(db, campaign, sessionId).map(renderPause);
}

/** The pause with this id in this session; 404 when it has none. */
function requirePauseRow(db: GrimoireDb, campaign: string, sessionId: string, id: string): PauseRow {
  const row = db
    .select()
    .from(pauses)
    .where(
      and(eq(pauses.campaignId, campaign), eq(pauses.sessionId, sessionId), eq(pauses.id, id)),
    )
    .all()[0];
  if (row === undefined) throw new ApiError(404, "pause not found");
  return row;
}

// --- writing ------------------------------------------------------------------

/** The body of a pause POST: nothing — a pause begins on the server's clock. */
export function readPauseCreate(raw: unknown): PauseCreate {
  return parseRequest(pauseCreateSchema, raw, "pause");
}

/**
 * POST /api/campaigns/:campaign/sessions/:session/pauses — begin a pause now.
 * The session has to run (404 for an unknown one, 409 `session_ended` for an
 * ended one). A session that is paused already keeps its one open pause:
 * that pause comes back unchanged, `created` false.
 */
export async function createPause(
  campaign: string,
  sessionId: string,
): Promise<{ pause: Pause; created: boolean }> {
  return mutate(campaign, (tx) => {
    requireRunningSessionRow(tx, campaign, sessionId);
    const rows = pauseRowsOf(tx, campaign, sessionId);
    const open = rows.find((row) => row.toTs === null);
    if (open !== undefined) return { pause: renderPause(open), created: false };
    const id = randomUUID();
    tx.insert(pauses)
      .values({
        campaignId: campaign,
        sessionId,
        id,
        fromTs: format(new Date(), LOCAL_DATE_TIME_SECONDS),
        toTs: null,
        pos: nextPos(rows),
      })
      .run();
    return { pause: renderPause(requirePauseRow(tx, campaign, sessionId, id)), created: true };
  });
}

/**
 * The body of a pause PATCH, checked against the pause's schema: the guard,
 * `force` and its ends as epoch values — a key that is none of these, or a
 * value of the wrong shape, is a 400 that names it.
 */
export function readPausePatch(raw: unknown): PausePatch {
  return parseRequest(pausePatchSchema, raw, "pause patch");
}

/**
 * PATCH /api/campaigns/:campaign/sessions/:session/pauses/:id — end the pause
 * (`toMs`) or correct either end, in one row update against its `rev`. The
 * session may be ended: correcting a pause is part of looking back. A patch
 * that names no field is 400 `nothing_to_write`; the id may be echoed, never
 * changed.
 *
 * A stale `rev` is 409 with the current pause under `pause`; `force` writes
 * the given fields on top of it instead. An unknown session or pause is 404.
 */
export async function patchPause(
  campaign: string,
  sessionId: string,
  id: string,
  patch: PausePatch,
): Promise<Pause> {
  const { rev, force, id: patchedId, fromMs, toMs } = patch;
  if (fromMs === undefined && toMs === undefined && patchedId === undefined) {
    throw new ApiError(400, "nothing to write — send fromMs or toMs", {
      code: "nothing_to_write",
    });
  }
  return mutate(campaign, (tx) => {
    requireSessionRow(tx, campaign, sessionId);
    const row = requirePauseRow(tx, campaign, sessionId, id);
    const guard = force === true ? row.rev : rev;
    if (row.rev !== guard) {
      throw revConflict(row.rev, "pause changed", { pause: renderPause(row) });
    }
    if (patchedId !== undefined && patchedId !== row.id) {
      throw new ApiError(400, "id is the primary key — it is set at creation and never changes");
    }
    const next: PauseRow = {
      ...row,
      fromTs: fromMs === undefined ? row.fromTs : epochToLocalDateTime(fromMs),
      toTs: toMs === undefined ? row.toTs : epochToLocalDateTime(toMs),
      rev: row.rev + 1,
    };
    tx.update(pauses)
      .set({ fromTs: next.fromTs, toTs: next.toTs, rev: next.rev })
      .where(
        and(eq(pauses.campaignId, campaign), eq(pauses.sessionId, sessionId), eq(pauses.id, id)),
      )
      .run();
    return renderPause(next);
  });
}

/**
 * Close the session's open pause at `to`, INSIDE the caller's transaction —
 * ending a session ends its pause at the same moment. The pause's `rev`
 * moves with it.
 */
export function closeOpenPause(tx: GrimoireDb, campaign: string, sessionId: string, to: string): void {
  for (const row of pauseRowsOf(tx, campaign, sessionId)) {
    if (row.toTs !== null) continue;
    tx.update(pauses)
      .set({ toTs: to, rev: row.rev + 1 })
      .where(
        and(eq(pauses.campaignId, campaign), eq(pauses.sessionId, sessionId), eq(pauses.id, row.id)),
      )
      .run();
  }
}

// --- the seed -----------------------------------------------------------------

/**
 * Write one pause of a session fixture, after the ones before it, INSIDE the
 * caller's transaction.
 */
export function insertPauseSeed(
  tx: GrimoireDb,
  campaign: string,
  sessionId: string,
  seed: PauseSeed,
): void {
  tx.insert(pauses)
    .values({
      campaignId: campaign,
      sessionId,
      id: seed.id,
      fromTs: seed.from,
      toTs: seed.to ?? null,
      pos: nextPos(pauseRowsOf(tx, campaign, sessionId)),
    })
    .run();
}
