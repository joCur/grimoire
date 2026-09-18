// A session: the evening's cycle, its log and its pauses.
//
// Start, pause, continue, end, discard — plus the quick note that grows the
// log and the scenes it played, the review's "seen" flag, and the one patch
// the DM makes by hand (the timestamps). Reads and writes answer the same
// `SessionResponse`, because a session is not an entry and has no address
// (ADR #26); the rows behind all of it are ./session-rows.ts.

import { and, eq } from "drizzle-orm";
import {
  ENTITY_SLUG,
  isEnded,
  isSessionEmpty,
  type PatchSessionRequest,
  type SessionResponse,
  type SessionSummary,
} from "@grimoire/shared";
import { format } from "date-fns";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { logEntries, sessionPauses, sessionScenesPlayed, sessions } from "../db/schema";
import { mutate, requireCampaign } from "./campaigns";
import { assertSceneRef } from "./entity-rows";
import { getDb } from "./handle";
import type { SessionRow } from "./render";
import {
  appendLogRow,
  bumpSessionRev,
  closeOpenPauses,
  logRows,
  pauseRows,
  pickSession,
  playedScenes,
  renderSessionRow,
  requireActive,
  sessionRow,
  sessionSummaries,
} from "./session-rows";
import { asMap, asOptStr, nextPos } from "./shared";
import { LOCAL_DATE_TIME_SECONDS, LOCAL_DATE_TIME_SHAPE, localDateTimeToMs } from "./time";

// --- reading a session --------------------------------------------------------

/**
 * GET /api/campaigns/:campaign/sessions — the campaign's sessions, newest
 * first (`started`, with the row's insertion time as the tie-break: several
 * sessions per day are possible and the opaque id orders nothing).
 */
export async function listSessions(campaign: string): Promise<SessionSummary[]> {
  await requireCampaign(campaign);
  return sessionSummaries(await getDb(), campaign);
}

/**
 * GET /api/campaigns/:campaign/session — the ACTIVE session, or NULL when
 * none runs. With `includeEnded` it is the last STARTED session, ended or
 * not, and null only when the campaign has no session at all.
 *
 * `null` and not a 404: "no session is running" is the ordinary state of a
 * campaign between two evenings, and a 404 would make every reader
 * special-case an answer that means nothing is wrong.
 */
export async function readActiveSession(
  campaign: string,
  includeEnded = false,
): Promise<SessionResponse | null> {
  await requireCampaign(campaign);
  const db = await getDb();
  const row = pickSession(db, campaign, includeEnded);
  return row === undefined ? null : renderSessionRow(db, campaign, row);
}

/** GET /api/campaigns/:campaign/sessions/:id — 404 for an unknown id. */
export async function readSession(campaign: string, id: string): Promise<SessionResponse> {
  await requireCampaign(campaign);
  const db = await getDb();
  const row = sessionRow(db, campaign, id);
  if (row === undefined) throw new ApiError(404, "session not found");
  return renderSessionRow(db, campaign, row);
}

// --- the local-time formats and the new row -----------------------------------

/**
 * `yyyy-mm-dd` in local time — today's calendar day, which a start compares
 * the running session's `started` against.
 */
const LOCAL_DATE = "yyyy-MM-dd";

/** `HH:MM` in local time — the timestamp a log line carries. */
const LOCAL_TIME = "HH:mm";

/**
 * The id for a NEW session: an OPAQUE RANDOM string, `crypto.randomUUID()`.
 * See db/schema.ts (`sessions`) for the reasoning — in short, nobody reads a
 * session id, so it needs no shape, and a random one needs no coordination:
 * the former `yyyy-mm-dd-<n>` scheme had to persist a per-day high-water mark
 * in `meta` so a discarded session's id could not be re-issued onto another
 * evening's log rows. A random id is unique whether or not the row it named
 * still exists.
 *
 * `crypto` is the WHATWG global (Node ≥ 19 and Bun) — no import, no npm
 * dependency, no hand-rolled base32 encoder (DECISIONS: Node portability).
 */
function newSessionId(): string {
  return crypto.randomUUID();
}

/**
 * The CALENDAR DAY of a session's `started`, or undefined when the value says
 * nothing usable. Just the date part of the zone-less wall-clock string the
 * format carries — no timezone arithmetic, because the string already is the
 * server's local reading (./time).
 */
function startedDate(started: string | null): string | undefined {
  return /^(\d{4}-\d{2}-\d{2})/.exec(started ?? "")?.[1];
}

/**
 * The `createdAt` for a new session row: the ORDER tie-break behind `started`
 * (db/schema.ts), in epoch milliseconds and STRICTLY greater than every
 * createdAt the campaign already holds.
 *
 * Hence the `highest + 1` floor rather than a plain `Date.now()`: the value
 * must be monotonic — "start, beenden, wieder starten" inside one millisecond
 * has to order, and so does a clock that jumped backwards (NTP, DST on a
 * machine that stores UTC wrong) or one a test froze. Without the floor every
 * row of such a run would share the tie-break, and the order would fall back
 * to the query's row order again.
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

// --- the cycle ----------------------------------------------------------------

/**
 * POST /api/campaigns/:campaign/session/start — two answers:
 *
 *   * a RUNNING session of today is returned untouched (the start button
 *     stays idempotent while the evening runs);
 *   * an OLDER running session is a 409 `session_running` — ending someone
 *     else's evening is not implied by "starten";
 *   * otherwise a NEW session is created, even when today already has ended
 *     ones. "Beenden" is final: the new row gets its own id,
 *     an empty log and a runtime that starts at 0. The former 409
 *     `session_ended` and POST /session/resume are gone with it.
 */
export async function startSession(campaign: string): Promise<SessionResponse> {
  return mutate(campaign, (tx) => {
    const d = new Date();
    const today = format(d, LOCAL_DATE);
    const active = pickSession(tx, campaign, false);
    // "Is the running session TODAY's?" is answered by `started`, not by the
    // id — the id is opaque and says nothing about a day.
    //
    // A row whose `started` is unreadable is not the "running session" in the
    // first place — it has no place in the chronology (store/shared.ts
    // `sessionOrderKey`) — so `pickSession` never returns it here and the next
    // start simply opens a new session. `startedDate` therefore only ever
    // decides between today and an EARLIER day.
    if (active !== undefined && startedDate(active.started) !== today) {
      throw new ApiError(409, "another session is still running — end it first", {
        code: "session_running",
        id: active.id,
      });
    }
    if (active !== undefined) return renderSessionRow(tx, campaign, active);
    const id = newSessionId();
    tx.insert(sessions)
      .values({
        campaignId: campaign,
        id,
        started: format(d, LOCAL_DATE_TIME_SECONDS),
        createdAt: nextCreatedAt(tx, campaign),
      })
      .run();
    const row = sessionRow(tx, campaign, id);
    if (row === undefined) throw new ApiError(500, "session could not be created");
    return renderSessionRow(tx, campaign, row);
  });
}

/**
 * POST /session/end — set `ended` in the ACTIVE session (which may be
 * yesterday's row when the evening ran past midnight). Idempotent: with
 * nothing running it falls back to the last started session and keeps its
 * existing `ended`; an OPEN pause is closed by the end.
 */
export async function endSession(campaign: string): Promise<SessionResponse> {
  return mutate(campaign, (tx) => {
    const row = pickSession(tx, campaign, false) ?? pickSession(tx, campaign, true);
    if (row === undefined) throw new ApiError(404, "no active session");
    if (isEnded({ ended: row.ended })) return renderSessionRow(tx, campaign, row);
    const d = new Date();
    closeOpenPauses(tx, campaign, row.id, format(d, LOCAL_DATE_TIME_SECONDS));
    const ended = format(d, LOCAL_DATE_TIME_SECONDS);
    tx.update(sessions)
      .set({ ended, rev: row.rev + 1 })
      .where(and(eq(sessions.campaignId, campaign), eq(sessions.id, row.id)))
      .run();
    return renderSessionRow(tx, campaign, { ...row, ended, rev: row.rev + 1 });
  });
}

/**
 * POST /session/pause — really STOP the clock: one open `pauses` interval.
 * Idempotent: pausing a paused session changes nothing.
 *
 * No log row is written for it. A pause IS a `session_pauses` row, and the
 * `— Pause` line the log used to carry was the same pause written a second
 * time — a marker the reader of a text needed and a reader of rows does not
 * (ADR #26).
 */
export async function pauseSession(campaign: string): Promise<SessionResponse> {
  return mutate(campaign, (tx) => {
    const row = requireActive(tx, campaign);
    const pauses = pauseRows(tx, campaign, row.id);
    if (pauses.some((p) => p.toTs === null)) return renderSessionRow(tx, campaign, row);
    const d = new Date();
    tx.insert(sessionPauses)
      .values({
        campaignId: campaign,
        sessionId: row.id,
        pos: nextPos(pauses),
        fromTs: format(d, LOCAL_DATE_TIME_SECONDS),
        toTs: null,
      })
      .run();
    bumpSessionRev(tx, campaign, row);
    return renderSessionRow(tx, campaign, { ...row, rev: row.rev + 1 });
  });
}

/**
 * POST /session/continue — close the open interval. It ends a PAUSE, not a
 * session. No log row either, for the reason above.
 */
export async function continueSession(campaign: string): Promise<SessionResponse> {
  return mutate(campaign, (tx) => {
    const row = requireActive(tx, campaign);
    const d = new Date();
    if (!closeOpenPauses(tx, campaign, row.id, format(d, LOCAL_DATE_TIME_SECONDS))) {
      return renderSessionRow(tx, campaign, row);
    }
    bumpSessionRev(tx, campaign, row);
    return renderSessionRow(tx, campaign, { ...row, rev: row.rev + 1 });
  });
}

/**
 * POST /session/discard — DELETE the active session, the undo of a mis-clicked
 * "Session starten". Allowed only while it is EMPTY (no log row, no played
 * scene, no hand-written body); everything else is ended, not deleted -> 409
 * `session_not_empty`.
 *
 * It answers `{ id }`, the session that is gone. Not an address: a session
 * never had one to hand back (ADR #26).
 */
export async function discardSession(campaign: string): Promise<{ id: string }> {
  return mutate(campaign, (tx) => {
    const row = requireActive(tx, campaign);
    const log = logRows(tx, campaign, row.id);
    const played = playedScenes(tx, campaign, row.id);
    const empty =
      log.length === 0 && isSessionEmpty({ scenes_played: played }, row.body);
    if (!empty) {
      throw new ApiError(409, "this session has content — end it instead of discarding it", {
        code: "session_not_empty",
        id: row.id,
      });
    }
    tx.delete(sessions)
      .where(and(eq(sessions.campaignId, campaign), eq(sessions.id, row.id)))
      .run();
    return { id: row.id };
  });
}

// --- the log ------------------------------------------------------------------

/**
 * POST /api/campaigns/:campaign/log — append `- HH:MM (sceneId) text` to the RUNNING
 * session; 404 when none runs (a note typed after "Session beenden" is
 * refused instead of landing in a closed log). With a sceneId
 * `scenes_played` is maintained in the same transaction.
 */
export async function appendLogEntry(
  campaign: string,
  text: string,
  sceneId?: string,
): Promise<SessionResponse> {
  // A scene is referenced by its id, and an id is a slug — the same rule
  // `createNpcStub` holds. The column is a foreign key, so a value outside
  // that shape could only be a client bug.
  if (sceneId !== undefined && !ENTITY_SLUG.test(sceneId)) {
    throw new ApiError(400, "sceneId must be a kebab-case slug (a-z, 0-9, single dashes)");
  }
  return mutate(campaign, (tx) => {
    const row = requireActive(tx, campaign);
    // The note's scene is a reference: it has to name a scene that exists,
    // and nothing is created for it.
    if (sceneId !== undefined) assertSceneRef(tx, campaign, sceneId, "log_scene_unknown");
    appendLogRow(tx, campaign, row.id, format(new Date(), LOCAL_TIME), sceneId ?? null, text);
    if (sceneId !== undefined) {
      const played = playedScenes(tx, campaign, row.id);
      if (!played.includes(sceneId)) {
        tx.insert(sessionScenesPlayed)
          .values({
            campaignId: campaign,
            sessionId: row.id,
            sceneId,
            pos: played.length,
          })
          .run();
      }
    }
    bumpSessionRev(tx, campaign, row);
    return renderSessionRow(tx, campaign, { ...row, rev: row.rev + 1 });
  });
}

// --- review actions ------------------------------------------------------------

/**
 * POST /api/campaigns/:campaign/review/seen `{ sessionId, logId }` — mark one
 * log row as reviewed. `reviewed` is a flag on the row (db/schema.ts), and
 * `logId` is the row's own id (`SessionLogEntry.id`).
 *
 * Idempotent: a row that already carries the flag is answered unchanged, and
 * nothing is written, so the session's guard token stands.
 *
 * 404 when the session has no row with that id. The review reads the log and
 * sends back an id it read, so a miss is the session having moved on or a
 * caller inventing ids — both worth saying out loud instead of hiding behind
 * a 200 that changed nothing.
 */
export async function markLogLineSeen(
  campaign: string,
  sessionId: string,
  logId: string,
): Promise<SessionResponse> {
  return mutate(campaign, (tx) => {
    const row = sessionRow(tx, campaign, sessionId);
    if (row === undefined) throw new ApiError(404, "session not found");
    const entry = logRows(tx, campaign, sessionId).find((l) => l.hash === logId);
    if (entry === undefined) throw new ApiError(404, "no such log entry in this session");
    if (entry.reviewed !== 0) return renderSessionRow(tx, campaign, row);
    tx.update(logEntries)
      .set({ reviewed: 1 })
      .where(
        and(
          eq(logEntries.campaignId, campaign),
          eq(logEntries.sessionId, sessionId),
          eq(logEntries.pos, entry.pos),
        ),
      )
      .run();
    bumpSessionRev(tx, campaign, row);
    return renderSessionRow(tx, campaign, { ...row, rev: row.rev + 1 });
  });
}

// --- the timestamps the DM edits ----------------------------------------------

/**
 * A session timestamp a write may carry: the ONE shape a stored timestamp has
 * (./time.ts), or nothing.
 *
 * The same closedness a closed field has (store/shared.ts), one layer down.
 * `started`, `ended` and the two ends of a pause are written from the
 * server's own clock everywhere else; a PATCH of a session is the only door
 * through which a
 * value from outside reaches those columns, and without this guard it was a
 * door PAST the boot pre-flight (db/timestamp-preflight.ts): a stored `19:30`
 * leaves that session without a place in the campaign's chronology, and the
 * next start refuses the database over a value the app itself wrote.
 *
 * An EMPTY value is left through. `null` clears the column, and a blank
 * string is "not set" to the reader and to the pre-flight alike — refusing it
 * would make clearing a field depend on how the caller spells "nothing".
 */
function assertTimestamp(value: string | null, field: string): void {
  if (value === null || value.trim() === "") return;
  if (localDateTimeToMs(value) !== undefined) return;
  throw new ApiError(400, `invalid ${field}: ${value} — expected ${LOCAL_DATE_TIME_SHAPE}`, {
    code: "timestamp_not_allowed",
    field,
    value,
  });
}

/**
 * The pause rows a `pauses` patch becomes, in the order they will be stored.
 * An entry without `from` is not a pause and drops out — the positions close
 * up behind it, so `pos` stays a gap-less sequence.
 *
 * Both ends go through the timestamp guard here rather than at the insert,
 * because the whole list is checked before the first row is written.
 */
function patchedPauses(value: unknown): { fromTs: string; toTs: string | null }[] {
  const entries = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const rows: { fromTs: string; toTs: string | null }[] = [];
  entries.forEach((entry, index) => {
    const map = asMap(entry);
    const fromTs = asOptStr(map.from);
    if (fromTs === null) return;
    const toTs = asOptStr(map.to);
    assertTimestamp(fromTs, `pauses[${index}].from`);
    assertTimestamp(toTs, `pauses[${index}].to`);
    rows.push({ fromTs, toTs });
  });
  return rows;
}

/**
 * PATCH /api/campaigns/:campaign/sessions/:id `{ rev, started?, ended?,
 * pauses? }` — the TIMESTAMPS of a session, which is everything about it the
 * DM edits by hand: a start typed into the wrong hour, a pause that was
 * never closed.
 *
 * The log and `scenesPlayed` are not patchable. They grow through their own
 * endpoints (`POST /log`, the review actions), and a whole-list write of an
 * append-only log is not an edit anybody asked for.
 *
 * Three rules, the same ones every guarded write follows:
 *
 *   * a field that is ABSENT keeps its stored value; `ended: null` clears it
 *     and the session runs again, and `pauses` replaces the whole list.
 *   * EVERY timestamp of the request is checked before the first write, so a
 *     refusal (400 `timestamp_not_allowed`) refuses the whole patch and not
 *     its tail.
 *   * a stale `rev` is 409 `rev_conflict` carrying the current `rev` and the
 *     current SESSION, so the conflict dialog shows what is in the way
 *     without a second request. The key is `session` and not `entry`: a
 *     session is not an entry (ADR #26).
 */
export async function patchSession(
  campaign: string,
  id: string,
  request: PatchSessionRequest,
): Promise<SessionResponse> {
  const touches =
    request.started !== undefined || request.ended !== undefined || request.pauses !== undefined;
  if (!touches) {
    throw new ApiError(400, "nothing to write — send started, ended or pauses", {
      code: "nothing_to_write",
    });
  }
  return mutate(campaign, (tx) => {
    const row = sessionRow(tx, campaign, id);
    if (row === undefined) throw new ApiError(404, "session not found");
    if (row.rev !== request.rev) {
      throw new ApiError(409, "session changed — reload before saving", {
        code: "rev_conflict",
        rev: row.rev,
        session: renderSessionRow(tx, campaign, row),
      });
    }
    const started = request.started === undefined ? row.started : asOptStr(request.started);
    const ended = request.ended === undefined ? row.ended : asOptStr(request.ended);
    assertTimestamp(started, "started");
    assertTimestamp(ended, "ended");
    const nextPauses =
      request.pauses === undefined ? undefined : patchedPauses(request.pauses);

    tx.update(sessions)
      .set({ started, ended, rev: row.rev + 1 })
      .where(and(eq(sessions.campaignId, campaign), eq(sessions.id, id)))
      .run();

    if (nextPauses !== undefined) {
      tx.delete(sessionPauses)
        .where(and(eq(sessionPauses.campaignId, campaign), eq(sessionPauses.sessionId, id)))
        .run();
      nextPauses.forEach((pause, pos) => {
        tx.insert(sessionPauses)
          .values({ campaignId: campaign, sessionId: id, pos, ...pause })
          .run();
      });
    }
    const updated = sessionRow(tx, campaign, id);
    return renderSessionRow(tx, campaign, updated ?? { ...row, rev: row.rev + 1 });
  });
}
