// Rows → the API's entry shapes.
//
// The campaign, chapters and scenes are rendered here into an
// `EntryResponse`: an address, a `properties` mapping, a markdown body, and
// the concurrency token the client sends back. The npc and the location have
// their own types (ADR #31) and render themselves in their domain modules
// (./npcs.ts, ./locations.ts); their row shapes stand below with the others.
//
// Three rules hold this together:
//
//   1. `properties` IS REBUILT IN CONTRACT ORDER — the README's order, and
//      nothing beside it: a stored entry has exactly the fields the contract
//      names (db/schema.ts rule 1). The display-name fallbacks stay
//      (`title`/`name` fall back to the id), applied once, here.
//   2. THE BODY IS A DETERMINISTIC RENDERING, not a stored byte sequence. It
//      is the editor's display value; no byte guarantees are made or needed.
//   3. THE GUARD TOKEN `rev` IS THE ROW'S VERSION COUNTER. The app has
//      always treated it as opaque, and the row version cannot collide
//      inside one second.
//
// A SESSION and THE INBOX are not entries and are not rendered to a text at
// all (ADR #26): their rows travel AS rows — `SessionResponse` and
// `InboxResponse` — and this module builds those shapes too. Nothing here
// composes a markdown list, and nothing anywhere reads one back.

import type {
  EntryResponse,
  InboxEntry,
  InboxResponse,
  SessionLogEntry,
  SessionPauseInterval,
  SessionResponse,
  SessionSummary,
} from "@grimoire/shared";
import { localDateTimeToMs } from "./time";
import { unpackStringArray } from "../db/schema";
import { CAMPAIGN_PATH, chapterPath, sceneAddress } from "./paths";

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

// --- properties assembly ---------------------------------------------------

/** Drop `undefined`/`null` values so absent columns produce absent keys. */
function compact(entries: Array<[string, unknown]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (value === undefined || value === null) continue;
    out[key] = value;
  }
  return out;
}

function parsed(
  path: string,
  kind: EntryResponse["kind"],
  properties: Record<string, unknown>,
  body: string,
  rev: number,
): EntryResponse {
  return { path, kind, properties, body, rev };
}

// --- per-kind rendering -----------------------------------------------------

/**
 * The campaign's display name: its stored name, or the id when there is none.
 *
 * `""` in the column means "no authored name" — a campaign created without
 * one, or seeded without one. The fallback to the id is applied HERE, once,
 * and everything that shows a campaign name reads it through this function:
 * the campaign entry (`GET /entry`) and the campaign list (`GET /campaigns`)
 * once disagreed about it.
 */
export function campaignDisplayName(row: CampaignRow): string {
  return row.name === "" ? row.id : row.name;
}

export function campaignProperties(row: CampaignRow): Record<string, unknown> {
  return compact([
    ["id", row.id],
    ["name", campaignDisplayName(row)],
    ["description", row.description],
  ]);
}

export function renderCampaign(row: CampaignRow): EntryResponse {
  return parsed(CAMPAIGN_PATH, "campaign", campaignProperties(row), row.body, row.rev);
}

export function chapterProperties(row: ChapterRow): Record<string, unknown> {
  return compact([
    ["id", row.id],
    ["title", row.title === "" ? row.id : row.title],
    ["status", row.status],
  ]);
}

export function renderChapter(row: ChapterRow): EntryResponse {
  return parsed(chapterPath(row.id), "chapter", chapterProperties(row), row.body, row.rev);
}

export function sceneProperties(
  row: SceneRow,
  npcs: string[],
  tags: string[],
): Record<string, unknown> {
  const handouts = unpackStringArray(row.handouts);
  return compact([
    ["id", row.id],
    ["title", row.title === "" ? row.id : row.title],
    // `type`/`status` are the two lifecycle fields every consumer reads;
    // they are always present so a status control never has to guess.
    ["type", row.type === "" ? "planned" : row.type],
    ["trigger", row.trigger],
    // The chapter is part of the scene's address — always present.
    ["chapter", row.chapterId],
    ["location", row.location],
    // Empty reference lists are omitted, not written as `[]`: the format
    // says nothing about them, so an absent list is an absent key.
    ["npcs", npcs.length === 0 ? undefined : npcs],
    ["handouts", handouts.length === 0 ? undefined : handouts],
    ["tags", tags.length === 0 ? undefined : tags],
    ["status", row.status === "" ? "draft" : row.status],
  ]);
}

export function renderScene(row: SceneRow, npcs: string[], tags: string[]): EntryResponse {
  return parsed(
    sceneAddress(row),
    "scene",
    sceneProperties(row, npcs, tags),
    row.body,
    row.rev,
  );
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
