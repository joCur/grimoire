// Rows → the API's entry shapes.
//
// Every read endpoint answers an `EntryResponse`: an address, a `properties`
// mapping, a markdown body, and the concurrency token the client sends back.
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
// Sections that became rows are rendered BACK from those rows: a session's
// `## Log`, the inbox list, the glossary. That is what keeps the reading view,
// the review and the markdown editor working on the same text they always saw.
//
// An npc's `## Beziehungen` is NOT among them any more. It is prose in the
// npc's own text and travels verbatim — nothing about an npc is derived from
// body text (db/schema.ts rule 3).

import type { EntityKind, EntryResponse } from "@grimoire/shared";
import { localDateTimeToMs } from "../clock";
import { unpackJson, unpackStringArray } from "../db/schema";
import {
  CAMPAIGN_PATH,
  chapterPath,
  GLOSSARY_PATH,
  INBOX_PATH,
  locationPath,
  npcPath,
  sceneAddress,
  scenePath,
  sessionPath,
} from "./paths";

// --- row shapes (the columns the renderer needs) ----------------------------

export interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  body: string;
  version: number;
  rev: number;
  /** The glossary's prose preamble and the three list entries' guard tokens. */
  glossaryIntro: string;
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
  body: string;
  rev: number;
}

export interface LocationRow {
  campaignId: string;
  id: string;
  name: string;
  chapterId: string | null;
  roll20Page: string | null;
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
   * content: it is deliberately absent from `sessionProperties`.
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
  raw: string;
  at: string | null;
  sceneId: string | null;
  text: string | null;
  hash: string;
  reviewed: number;
}

export interface InboxRow {
  pos: number;
  raw: string;
  text: string | null;
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
  kind: EntityKind,
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

export function npcProperties(row: NpcRow): Record<string, unknown> {
  const quickstats = unpackJson(row.quickstats);
  return compact([
    ["id", row.id],
    ["name", row.name === "" ? row.id : row.name],
    ["role", row.role],
    ["chapter", row.chapterId],
    ["status", row.status === "" ? "unknown" : row.status],
    ["statblock", row.statblock],
    ["quickstats", Object.keys(quickstats).length === 0 ? undefined : quickstats],
    ["voice", row.voice],
    ["appearance", row.appearance],
  ]);
}

/**
 * The npc entry. Its text is rendered exactly as it is stored,
 * `## Beziehungen` included: nothing about an npc is derived from body text.
 */
export function renderNpc(row: NpcRow): EntryResponse {
  return parsed(npcPath(row.id), "npc", npcProperties(row), row.body, row.rev);
}

export function locationProperties(row: LocationRow): Record<string, unknown> {
  return compact([
    ["id", row.id],
    ["name", row.name === "" ? row.id : row.name],
    ["chapter", row.chapterId],
    ["roll20-page", row.roll20Page],
  ]);
}

export function renderLocation(row: LocationRow): EntryResponse {
  return parsed(locationPath(row.id), "location", locationProperties(row), row.body, row.rev);
}

// --- sessions ---------------------------------------------------------------

export function sessionProperties(
  row: SessionRow,
  pauses: PauseRow[],
  log: LogRow[],
  played: string[],
): Record<string, unknown> {
  const reviewed = log.filter((l) => l.reviewed !== 0).map((l) => l.hash);
  return compact([
    ["id", row.id],
    ["started", row.started],
    ["ended", row.ended],
    // `scenes_played` is always present — the app reads it as a list and
    // the format's session skeleton writes `scenes_played: []`.
    ["scenes_played", played],
    [
      "pauses",
      pauses.length === 0
        ? undefined
        : pauses.map((p) => compact([["from", p.fromTs], ["to", p.toTs]])),
    ],
    ["reviewed", reviewed.length === 0 ? undefined : reviewed],
  ]);
}

/**
 * The session body: `## Log` rendered from `log_entries`, then whatever else
 * the session carries (`## Threads` above all), which is the row's own body.
 */
export function renderSessionBody(row: SessionRow, log: LogRow[]): string {
  const lines = log.map((l) => l.raw).join("\n");
  const logSection = `\n## Log\n${lines === "" ? "" : `\n${lines}\n`}`;
  const rest = row.body.replace(/^\n+/, "");
  return rest === "" ? logSection : `${logSection}\n${rest}`;
}

/**
 * The epoch interpretation of a session's zone-less timestamps — unchanged
 * arithmetic, unchanged reason: only the SERVER knows which wall
 * clock those digits belong to, so it ships the reading alongside the
 * strings. `clock.ts` is untouched by the cutover.
 */
export function sessionTimes(
  row: SessionRow,
  pauses: PauseRow[],
): Pick<EntryResponse, "startedMs" | "endedMs" | "pausedMs" | "pausedSinceMs"> {
  const startedMs = localDateTimeToMs(row.started);
  const endedMs = localDateTimeToMs(row.ended);
  let pausedMs = 0;
  let pausedSinceMs: number | undefined;
  for (const pause of pauses) {
    const from = localDateTimeToMs(pause.fromTs);
    if (from === undefined) continue;
    if (pause.toTs === null) {
      pausedSinceMs = from; // a later open interval wins
      continue;
    }
    const to = localDateTimeToMs(pause.toTs);
    if (to === undefined) continue;
    pausedMs += Math.max(0, to - from);
  }
  return {
    ...(startedMs === undefined ? {} : { startedMs }),
    ...(endedMs === undefined ? {} : { endedMs }),
    ...(pausedMs === 0 ? {} : { pausedMs }),
    ...(pausedSinceMs === undefined ? {} : { pausedSinceMs }),
  };
}

export function renderSession(
  row: SessionRow,
  pauses: PauseRow[],
  log: LogRow[],
  played: string[],
): EntryResponse {
  const properties = sessionProperties(row, pauses, log, played);
  const body = renderSessionBody(row, log);
  return {
    ...parsed(sessionPath(row.id), "session", properties, body, row.rev),
    ...sessionTimes(row, pauses),
  };
}

// --- inbox ------------------------------------------------------------------

/**
 * The inbox body from its rows, in `pos` order. Every row's `raw` is the line
 * verbatim — including the headings the format's skeleton carries — and a
 * blank line is put after a heading so the rendering reads like the inbox text did.
 */
export function renderInboxBody(rows: InboxRow[]): string {
  if (rows.length === 0) return "";
  const out: string[] = [];
  rows.forEach((row, index) => {
    out.push(row.raw);
    const next = rows[index + 1];
    if (next !== undefined && /^#{1,6}(\s|$)/.test(row.raw.trim())) out.push("");
  });
  return `\n${out.join("\n")}\n`;
}

export function renderInbox(campaignId: string, rows: InboxRow[], rev: number): EntryResponse {
  // The inbox's id is its address: there is exactly one per campaign.
  return parsed(INBOX_PATH, "inbox", { id: "inbox" }, renderInboxBody(rows), rev);
}

// --- glossary ---------------------------------------------------------------

/**
 * The glossary body from `glossary` rows — a RENDERING, for reading and for
 * the generator's prompt. A one-line explanation renders as the `EN → DE`
 * list line the format documents; a multi-line one gets its own `##`
 * section. It is never written back: the glossary is edited as a list.
 */
export function renderGlossaryBody(rows: GlossaryRow[], intro = ""): string {
  const listed = rows.filter((r) => !r.explanation.includes("\n"));
  const sectioned = rows.filter((r) => r.explanation.includes("\n"));
  const parts: string[] = [];
  // The prose above the first heading comes first — that is where it was
  // (campaigns.glossary_intro); it belongs to no term and must not vanish.
  if (intro !== "") parts.push(intro);
  if (listed.length > 0) {
    parts.push(listed.map((r) => `- ${r.term} → ${r.explanation}`).join("\n"));
  }
  for (const row of sectioned) parts.push(`## ${row.term}\n\n${row.explanation}`);
  if (parts.length === 0) return "";
  return `\n${parts.join("\n\n")}\n`;
}

export function renderGlossary(
  rows: GlossaryRow[],
  rev: number,
  intro = "",
): EntryResponse {
  return parsed(
    GLOSSARY_PATH,
    "glossary",
    { id: "glossary" },
    renderGlossaryBody(rows, intro),
    rev,
  );
}
