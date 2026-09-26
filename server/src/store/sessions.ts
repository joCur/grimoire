// Sessions: the session resource.
//
// A session is its own resource with its own type (ADR #31,
// @grimoire/shared/session): listed, read, started, ended and deleted here,
// typed by its one zod schema. It answers with its children embedded — its
// pauses (./pauses.ts) and its log (./log-entries.ts) —, but each child is
// written on its own resource, and a session write touches none of them, with one exception: ending a session
// ends its open pause at the same moment.
//
// `started` and `ended` are zone-less wall-clock strings (./time.ts): a start
// is the server's clock, and a moment from the wire arrives as an epoch value
// the server reads into that shape in its own timezone.

import { and, eq } from "drizzle-orm";
import { format } from "date-fns";
import {
  isSessionEmpty,
  isSessionEnded,
  sessionCreateSchema,
  sessionDeleteSchema,
  sessionPatchSchema,
  sessionSeedSchema,
  type Session,
  type SessionCreate,
  type SessionDelete,
  type SessionPatch,
  type SessionSeed,
  type SessionSummary,
} from "@grimoire/shared/session";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { sessions } from "../db/schema";
import { mutate, requireCampaign } from "./campaigns";
import { getDb } from "./handle";
import { insertLogEntrySeed, sessionLog } from "./log-entries";
import { closeOpenPause, insertPauseSeed, sessionPauses } from "./pauses";
import {
  requireSessionRow,
  runningSessionRow,
  sessionRowsNewestFirst,
  type SessionRow,
} from "./session-rows";
import { parseRequest, revConflict } from "./shared";
import { LOCAL_DATE_TIME_SECONDS, epochToLocalDateTime, localDateTimeToMs } from "./time";

/** `yyyy-mm-dd` in local time — the calendar day of a `started`. */
const LOCAL_DATE = "yyyy-MM-dd";

// --- rendering and reading ----------------------------------------------------

/**
 * The session's own fields of a row: the two moments with the server's epoch
 * reading beside them. A moment the server cannot read contributes no
 * reading, and an `ended` that is blank is no end.
 */
function sessionSummary(row: SessionRow): SessionSummary {
  const startedMs = localDateTimeToMs(row.started);
  const endedMs = localDateTimeToMs(row.ended);
  return {
    id: row.id,
    started: row.started ?? "",
    ...(startedMs === undefined ? {} : { startedMs }),
    ...(isSessionEnded(row) && row.ended !== null ? { ended: row.ended } : {}),
    ...(endedMs === undefined ? {} : { endedMs }),
  };
}

/** The session of a row, with its children embedded. */
function renderSession(db: GrimoireDb, campaign: string, row: SessionRow): Session {
  return {
    ...sessionSummary(row),
    body: row.body,
    pauses: sessionPauses(db, campaign, row.id),
    log: sessionLog(db, campaign, row.id),
    rev: row.rev,
  };
}

/** The value of the `running` filter of the session list. */
export type RunningFilter = "true" | undefined;

/**
 * GET /api/campaigns/:campaign/sessions[?running=true] — every session of the
 * campaign, NEWEST FIRST (`started`, with the row's insertion time as the
 * tie-break), or with `running` only the one that runs: none or one.
 */
export async function listSessions(campaign: string, running: RunningFilter): Promise<Session[]> {
  await requireCampaign(campaign);
  const db = await getDb();
  const rows =
    running === undefined
      ? sessionRowsNewestFirst(db, campaign)
      : [runningSessionRow(db, campaign)].filter((row) => row !== undefined);
  return rows.map((row) => renderSession(db, campaign, row));
}

/** GET /api/campaigns/:campaign/sessions/:id — 404 for an unknown id. */
export async function readSession(campaign: string, id: string): Promise<Session> {
  await requireCampaign(campaign);
  const db = await getDb();
  return renderSession(db, campaign, requireSessionRow(db, campaign, id));
}

/** The sessions of a campaign as the campaign tree lists them, newest first. */
export function sessionSummaries(db: GrimoireDb, campaign: string): SessionSummary[] {
  return sessionRowsNewestFirst(db, campaign).map(sessionSummary);
}

// --- starting a session --------------------------------------------------------

/**
 * The `createdAt` for a new session row: the ORDER tie-break behind `started`
 * (db/schema.ts), in epoch milliseconds and STRICTLY greater than every
 * createdAt the campaign already holds — a start, an end and another start
 * inside one millisecond still order, and so does a clock that jumped back.
 */
function nextCreatedAt(tx: GrimoireDb, campaign: string): number {
  const highest = tx
    .select({ createdAt: sessions.createdAt })
    .from(sessions)
    .where(eq(sessions.campaignId, campaign))
    .all()
    .reduce((acc, row) => Math.max(acc, row.createdAt), 0);
  return Math.max(Date.now(), highest + 1);
}

/** The body of a session POST: nothing — a session starts on the server's clock. */
export function readSessionCreate(raw: unknown): SessionCreate {
  return parseRequest(sessionCreateSchema, raw, "session");
}

/**
 * POST /api/campaigns/:campaign/sessions — start a session. Three answers:
 *
 *   * the RUNNING session, when it was started TODAY — the calendar day of
 *     its `started` —, comes back untouched with `created` false: pressing
 *     "start" twice re-enters the evening;
 *   * a running session of an EARLIER day is a 409 `session_running` naming
 *     it: ending someone else's evening is not implied by starting one;
 *   * otherwise a NEW session with an opaque random id, started now, even
 *     when today already has ended ones. Ending is final: a new session has
 *     its own empty log and a runtime that starts at 0.
 */
export async function createSession(
  campaign: string,
): Promise<{ session: Session; created: boolean }> {
  return mutate(campaign, (tx) => {
    const now = new Date();
    const running = runningSessionRow(tx, campaign);
    if (running !== undefined) {
      if (running.started?.startsWith(format(now, LOCAL_DATE)) !== true) {
        throw new ApiError(409, "another session is still running — end it first", {
          code: "session_running",
          id: running.id,
        });
      }
      return { session: renderSession(tx, campaign, running), created: false };
    }
    const id = crypto.randomUUID();
    tx.insert(sessions)
      .values({
        campaignId: campaign,
        id,
        started: format(now, LOCAL_DATE_TIME_SECONDS),
        createdAt: nextCreatedAt(tx, campaign),
      })
      .run();
    return { session: renderSession(tx, campaign, requireSessionRow(tx, campaign, id)), created: true };
  });
}

// --- writing a session ---------------------------------------------------------

/**
 * The body of a session PATCH, checked against the session's schema: the
 * guard, `force` and its moments as epoch values — a key that is none of
 * these, or a value of the wrong shape, is a 400 that names it.
 */
export function readSessionPatch(raw: unknown): SessionPatch {
  return parseRequest(sessionPatchSchema, raw, "session patch");
}

/**
 * PATCH /api/campaigns/:campaign/sessions/:id `{ rev, force?, startedMs?,
 * endedMs? }` — end the session (`endedMs`), let it run again
 * (`endedMs: null`) or correct its start, in one row update against its
 * `rev`. Ending closes an open pause at the same moment, and that pause's
 * `rev` moves with it. A patch that names no field is 400 `nothing_to_write`;
 * the id may be echoed, never changed.
 *
 * A stale `rev` is 409 with the current session under `session`; `force`
 * writes the given fields on top of it instead. An unknown id is 404.
 */
export async function patchSession(
  campaign: string,
  id: string,
  patch: SessionPatch,
): Promise<Session> {
  const { rev, force, id: patchedId, startedMs, endedMs } = patch;
  if (startedMs === undefined && endedMs === undefined && patchedId === undefined) {
    throw new ApiError(400, "nothing to write — send startedMs or endedMs", {
      code: "nothing_to_write",
    });
  }
  return mutate(campaign, (tx) => {
    const row = requireSessionRow(tx, campaign, id);
    const guard = force === true ? row.rev : rev;
    if (row.rev !== guard) {
      throw revConflict(row.rev, "session changed", {
        session: renderSession(tx, campaign, row),
      });
    }
    if (patchedId !== undefined && patchedId !== row.id) {
      throw new ApiError(400, "id is the primary key — it is set at creation and never changes");
    }
    const started = startedMs === undefined ? row.started : epochToLocalDateTime(startedMs);
    const ended =
      endedMs === undefined ? row.ended : endedMs === null ? null : epochToLocalDateTime(endedMs);
    if (ended !== null && endedMs !== undefined) closeOpenPause(tx, campaign, row.id, ended);
    tx.update(sessions)
      .set({ started, ended, rev: row.rev + 1 })
      .where(and(eq(sessions.campaignId, campaign), eq(sessions.id, row.id)))
      .run();
    return renderSession(tx, campaign, requireSessionRow(tx, campaign, row.id));
  });
}

/** The body of a session DELETE: the guard the session was read with. */
export function readSessionDelete(raw: unknown): SessionDelete {
  return parseRequest(sessionDeleteSchema, raw, "session delete");
}

/**
 * DELETE /api/campaigns/:campaign/sessions/:id `{ rev }` — the undo of a
 * mis-clicked start. Only an EMPTY session may go (`isSessionEmpty`): one
 * with content is ended, never deleted — 409 `session_not_empty`. A stale
 * `rev` is 409 with the current session under `session`; an unknown id is
 * 404. Either refusal removes nothing.
 */
export async function deleteSession(
  campaign: string,
  id: string,
  request: SessionDelete,
): Promise<void> {
  await mutate(campaign, (tx) => {
    const row = requireSessionRow(tx, campaign, id);
    const session = renderSession(tx, campaign, row);
    if (row.rev !== request.rev) {
      throw revConflict(row.rev, "session changed", { session });
    }
    if (!isSessionEmpty(session)) {
      throw new ApiError(409, "this session has content — end it instead of deleting it", {
        code: "session_not_empty",
        id: row.id,
      });
    }
    tx.delete(sessions)
      .where(and(eq(sessions.campaignId, campaign), eq(sessions.id, row.id)))
      .run();
  });
}

// --- the seed -----------------------------------------------------------------

/**
 * A session without its guards — a fixture — checked against the session's
 * schema. A key a session or one of its children does not have, or a value of
 * the wrong shape, is refused with the message `what` introduces.
 */
export function readSessionSeed(raw: unknown, what: string): SessionSeed {
  return parseRequest(sessionSeedSchema, raw, what);
}

/**
 * Write one session of a fixture with its children, INSIDE the caller's
 * transaction. The scenes of its log are foreign keys, so a fixture naming a
 * scene the campaign does not have is refused by the database. Nothing about a session is indexed for search.
 */
export function insertSessionSeed(tx: GrimoireDb, campaign: string, seed: SessionSeed): void {
  tx.insert(sessions)
    .values({
      campaignId: campaign,
      id: seed.id,
      started: seed.started === "" ? null : seed.started,
      ended: seed.ended ?? null,
      body: seed.body,
    })
    .run();
  for (const pause of seed.pauses) insertPauseSeed(tx, campaign, seed.id, pause);
  for (const entry of seed.log) insertLogEntrySeed(tx, campaign, seed.id, entry);
}
