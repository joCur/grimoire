// Rows and the shapes the lists answer.
//
// The row shape of every table the store renders stands here, so a domain
// module and its neighbours read one definition. Each entity with its own
// resource renders itself in its domain module (ADR #31: ./campaigns.ts,
// ./chapters.ts, ./scenes.ts, ./npcs.ts, ./locations.ts).
//
// A SESSION and THE INBOX are not rendered to a text at all (ADR #26): their
// rows travel AS rows — `SessionResponse` and `InboxResponse` — and this
// module builds those shapes. Nothing here composes a markdown list, and
// nothing anywhere reads one back.

import type {
  InboxEntry,
  InboxResponse,
  SessionLogEntry,
  SessionPauseInterval,
  SessionResponse,
  SessionSummary,
} from "@grimoire/shared";
import { localDateTimeToMs } from "./time";

// --- row shapes (the columns the renderer needs) ----------------------------

export interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  body: string;
  version: number;
  rev: number;
  /** Guard tokens of the two lists that have no row of their own. */
  glossaryRev: number;
  inboxRev: number;
  /** Guard token of the campaign-knowledge list. */
  knowledgeRev: number;
}

export interface ChapterRow {
  campaignId: string;
  id: string;
  title: string;
  status: string | null;
  body: string;
  pos: number;
  rev: number;
  /** Guard token of the chapter's scene ORDER, separate from `rev`. */
  sceneOrderRev: number;
  /** Guard token of the chapter's thread list, separate from `rev`. */
  threadsRev: number;
}

export interface SceneRow {
  campaignId: string;
  id: string;
  /** The owning chapter — never absent (schema.ts). */
  chapterId: string;
  title: string;
  type: string;
  trigger: string | null;
  location: string | null;
  status: string;
  handouts: string;
  body: string;
  pos: number;
  rev: number;
}

export interface NpcRow {
  campaignId: string;
  id: string;
  name: string;
  role: string | null;
  chapterId: string | null;
  status: string;
  statblock: string | null;
  quickstats: string;
  voice: string | null;
  appearance: string | null;
  motivation: string | null;
  body: string;
  rev: number;
}

export interface LocationRow {
  campaignId: string;
  id: string;
  name: string;
  chapterId: string | null;
  roll20Page: string | null;
  atmosphere: string | null;
  body: string;
  rev: number;
}

export interface SessionRow {
  campaignId: string;
  id: string;
  started: string | null;
  ended: string | null;
  /**
   * Insertion time of the row in epoch MILLISECONDS — the tie-break behind
   * `started` (db/schema.ts). Bookkeeping of the database, never authored
   * content: it is deliberately absent from every answer.
   */
  createdAt: number;
  body: string;
  rev: number;
}

export interface PauseRow {
  pos: number;
  fromTs: string;
  toTs: string | null;
}

export interface LogRow {
  pos: number;
  at: string | null;
  sceneId: string | null;
  text: string;
  hash: string;
  reviewed: number;
}

export interface InboxRow {
  pos: number;
  text: string;
  done: number;
}

export interface GlossaryRow {
  term: string;
  explanation: string;
  pos: number;
  rev: number;
}

// --- sessions ---------------------------------------------------------------

/**
 * The epoch reading of ONE zone-less timestamp, as the key/value pair it
 * contributes to a response. Only the SERVER knows which wall clock those
 * digits belong to, so it ships the reading beside the string and the client
 * does plain epoch arithmetic (./time reads it). An unreadable value simply
 * contributes nothing.
 */
function withMs(key: string, value: string | null): Record<string, number> {
  const ms = localDateTimeToMs(value);
  return ms === undefined ? {} : { [key]: ms };
}

/** The identifying head of a session — what a LIST shows of it. */
export function sessionSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    started: row.started ?? "",
    ...withMs("startedMs", row.started),
    ...(row.ended === null || row.ended === "" ? {} : { ended: row.ended }),
    ...withMs("endedMs", row.ended),
  };
}

/** One pause row as the interval the API answers, with both epoch readings. */
export function pauseInterval(row: PauseRow): SessionPauseInterval {
  return {
    from: row.fromTs,
    ...withMs("fromMs", row.fromTs),
    ...(row.toTs === null ? {} : { to: row.toTs }),
    ...withMs("toMs", row.toTs),
  };
}

/**
 * One log row as the API answers it. `id` is the row's `hash` — the stable
 * line id the review names a line by (db/schema.ts).
 *
 * The hashtags stay INSIDE `text`: they are body vocabulary (README), so the
 * note travels as the DM typed it and the reader highlights them.
 */
export function logEntry(row: LogRow): SessionLogEntry {
  return {
    id: row.hash,
    at: row.at ?? "",
    ...(row.sceneId === null ? {} : { sceneId: row.sceneId }),
    text: row.text,
    reviewed: row.reviewed !== 0,
  };
}

/**
 * ONE SESSION as every session endpoint answers it. Rows all the way down: no
 * address, no `properties` map, no markdown text (ADR #26).
 */
export function renderSession(
  row: SessionRow,
  pauses: PauseRow[],
  log: LogRow[],
  played: string[],
): SessionResponse {
  return {
    ...sessionSummary(row),
    pauses: pauses.map(pauseInterval),
    log: log.map(logEntry),
    scenesPlayed: played,
    rev: row.rev,
  };
}

// --- inbox ------------------------------------------------------------------

/**
 * One inbox row as the API answers it. `id` is the row's `pos` — the append
 * counter IS its key (db/schema.ts), and the list is append-only, so the
 * position a row was written at never moves.
 */
export function inboxEntry(row: InboxRow): InboxEntry {
  return { id: String(row.pos), text: row.text, done: row.done !== 0 };
}

/**
 * THE INBOX as a list plus the list's own guard token. Neither the inbox nor
 * the glossary is a single row that could carry a `rev`, so each has its
 * counter on the campaign row (`inbox_rev`/`glossary_rev`, db/schema.ts):
 * `campaigns.version` cannot stand in for them, because EVERY write bumps it
 * and one unrelated log line would invalidate an edit the DM had open.
 *
 * An EMPTY inbox is an empty list, not a missing one (200) — a 404 would make
 * every reader special-case an answer that means nothing is wrong.
 */
export function renderInbox(rows: InboxRow[], rev: number): InboxResponse {
  return { entries: rows.map(inboxEntry), rev };
}
