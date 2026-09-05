// Rows → the API's file shapes (issue #57).
//
// Every read endpoint still answers `ParsedFile`/`FileResponse`: a path, a
// frontmatter mapping, a markdown body, and the concurrency token the client
// sends back. Nothing about that contract changes with the cutover — only
// where the values come from.
//
// Three rules hold this together:
//
//   1. THE FRONTMATTER IS RECONSTRUCTED IN CONTRACT ORDER, then the preserved
//      unknown keys from `extra`. Same keys the parser produced, same
//      fallbacks (`title`/`name` fall back to the id — shared/parse.ts), so
//      the app cannot tell the difference.
//   2. `raw` IS A DETERMINISTIC RENDERING, not a stored byte sequence
//      (planning section 4). It is the editor's display value; no byte
//      guarantees are made or needed.
//   3. `mtimeMs` IS THE ROW'S `rev` (planning section 4: `mtimeMs := rev`).
//      The app has always treated it as an opaque guard token, so the wire
//      name stays and the semantics get stronger: a rev cannot collide
//      inside one second, which is exactly the bug of issue #37.
//
// Sections that became rows are rendered BACK from those rows: a session's
// `## Log`, an npc's `## Beziehungen`, the inbox list, the glossary. That is
// what keeps the reading view, the review and the markdown editor working on
// the same text they always saw.

import { CORE_SCHEMA, dump } from "js-yaml";
import type { FileResponse, ParsedFile } from "@grimoire/shared";
import { localDateTimeToMs } from "../clock";
import { unpackJson, unpackStringArray } from "../db/schema";
import {
  CAMPAIGN_PATH,
  chapterPath,
  GLOSSARY_PATH,
  INBOX_PATH,
  locationPath,
  npcPath,
  scenePath,
  sessionPath,
} from "./paths";

// --- row shapes (the columns the renderer needs) ----------------------------

export interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  body: string;
  extra: string;
  version: number;
  rev: number;
  /** The glossary's prose preamble and the two list documents' guard tokens. */
  glossaryIntro: string;
  glossaryRev: number;
  inboxRev: number;
}

export interface ChapterRow {
  campaignId: string;
  id: string;
  title: string;
  status: string | null;
  body: string;
  extra: string;
  pos: number;
  rev: number;
}

export interface SceneRow {
  campaignId: string;
  id: string;
  chapterId: string | null;
  /** 1 when the frontmatter declares `chapter:` (schema.ts). */
  chapterDeclared: number;
  groupSlug: string;
  title: string;
  type: string;
  trigger: string | null;
  location: string | null;
  status: string;
  handouts: string;
  body: string;
  extra: string;
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
  extra: string;
  rev: number;
}

export interface LocationRow {
  campaignId: string;
  id: string;
  name: string;
  chapterId: string | null;
  roll20Page: string | null;
  body: string;
  extra: string;
  rev: number;
}

export interface SessionRow {
  campaignId: string;
  id: string;
  started: string | null;
  ended: string | null;
  body: string;
  extra: string;
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

// --- frontmatter assembly ---------------------------------------------------

/** Drop `undefined`/`null` values so absent columns produce absent keys. */
function compact(entries: Array<[string, unknown]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (value === undefined || value === null) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Contract keys first (their order is the README's), preserved unknown keys
 * after. `extra` never shadows a contract key: the column IS the value, and
 * an `extra` copy would be the stale one.
 */
function withExtra(
  contract: Record<string, unknown>,
  extra: string,
): Record<string, unknown> {
  const out = { ...contract };
  for (const [key, value] of Object.entries(unpackJson(extra))) {
    if (key in out) continue;
    out[key] = value;
  }
  return out;
}

/** `raw` of a file: the YAML block plus the body (rule 2 above). */
export function renderRaw(frontmatter: Record<string, unknown>, body: string): string {
  if (Object.keys(frontmatter).length === 0) return body;
  // Same dump options as the write layer used for files: flowLevel 1 keeps
  // nested collections inline ([a, b]) and CORE_SCHEMA leaves timestamp-like
  // strings unquoted.
  const yaml = dump(frontmatter, { schema: CORE_SCHEMA, flowLevel: 1, lineWidth: -1 });
  return `---\n${yaml}---\n${body}`;
}

function parsed(
  path: string,
  kind: ParsedFile["kind"],
  frontmatter: Record<string, unknown>,
  body: string,
  rev: number,
): FileResponse {
  return { path, kind, frontmatter, body, mtimeMs: rev, raw: renderRaw(frontmatter, body) };
}

// --- per-kind rendering -----------------------------------------------------

export function campaignFrontmatter(row: CampaignRow): Record<string, unknown> {
  return withExtra(
    compact([
      ["id", row.id],
      // The parser falls a missing `name` back to the id; the migration
      // stored "" for exactly that case (campaign-fs.ts campaignMeta), so
      // the fallback is reapplied here instead of being baked in.
      ["name", row.name === "" ? row.id : row.name],
      ["description", row.description],
    ]),
    row.extra,
  );
}

export function renderCampaign(row: CampaignRow): FileResponse {
  return parsed(CAMPAIGN_PATH, "campaign", campaignFrontmatter(row), row.body, row.rev);
}

export function chapterFrontmatter(row: ChapterRow): Record<string, unknown> {
  return withExtra(
    compact([
      ["id", row.id],
      ["title", row.title === "" ? row.id : row.title],
      ["status", row.status],
    ]),
    row.extra,
  );
}

export function renderChapter(row: ChapterRow): FileResponse {
  return parsed(chapterPath(row.id), "chapter", chapterFrontmatter(row), row.body, row.rev);
}

export function sceneFrontmatter(
  row: SceneRow,
  npcs: string[],
  tags: string[],
): Record<string, unknown> {
  const handouts = unpackStringArray(row.handouts);
  return withExtra(
    compact([
      ["id", row.id],
      ["title", row.title === "" ? row.id : row.title],
      // `type`/`status` are the two lifecycle fields every consumer reads;
      // they are always present so a status control never has to guess.
      ["type", row.type === "" ? "planned" : row.type],
      ["trigger", row.trigger],
      // The ADDRESS keeps the chapter either way; the key is only rendered
      // while the frontmatter declares it (schema.ts `chapter_declared`), so
      // `PATCH { chapter: null }` can delete it as it always could.
      ["chapter", row.chapterDeclared === 0 ? null : row.chapterId],
      ["location", row.location],
      // Empty reference lists are omitted, not written as `[]`: the format
      // says nothing about them, and an authored file had no key either.
      ["npcs", npcs.length === 0 ? undefined : npcs],
      ["handouts", handouts.length === 0 ? undefined : handouts],
      ["tags", tags.length === 0 ? undefined : tags],
      ["status", row.status === "" ? "draft" : row.status],
    ]),
    row.extra,
  );
}

export function renderScene(row: SceneRow, npcs: string[], tags: string[]): FileResponse {
  return parsed(
    scenePath(row.chapterId ?? "", row.groupSlug, row.id),
    "scene",
    sceneFrontmatter(row, npcs, tags),
    row.body,
    row.rev,
  );
}

/** `## Beziehungen` rendered back from `npc_relations` (in `pos` order). */
export function renderRelationsSection(
  relations: Array<{ otherNpcId: string; note: string }>,
): string {
  if (relations.length === 0) return "";
  const lines = relations.map((r) => (r.note === "" ? `- ${r.otherNpcId}:` : `- ${r.otherNpcId}: ${r.note}`));
  return `## Beziehungen\n\n${lines.join("\n")}\n`;
}

/** The `## Beziehungen` heading a body kept because it still holds prose. */
const RELATIONS_HEADING = /^##[ \t]+Beziehungen[ \t]*\r?$/im;

/**
 * The npc body with its relations rows rendered back in.
 *
 * Two cases, and the second one is why this is not a plain append:
 *
 *   * the body has NO `## Beziehungen` section (the normal case — the whole
 *     section became rows): the section is appended at the END, which is
 *     deterministic; its original position inside the file was never part of
 *     the contract.
 *   * the body still HAS the section: it kept lines that became no row —
 *     prose, a note without a colon, a duplicate counterpart
 *     (`removeRelationLines`). The rows then go back INTO that section, above
 *     what stayed, so the DM sees one `## Beziehungen` in its original place
 *     with nothing missing.
 */
export function renderNpcBody(
  row: NpcRow,
  relations: Array<{ otherNpcId: string; note: string }>,
): string {
  const kept = RELATIONS_HEADING.exec(row.body);
  if (kept !== null) {
    const lines = relations.map((r) =>
      r.note === "" ? `- ${r.otherNpcId}:` : `- ${r.otherNpcId}: ${r.note}`,
    );
    if (lines.length === 0) return row.body;
    const headingEnd = kept.index + kept[0].length;
    return `${row.body.slice(0, headingEnd)}\n\n${lines.join("\n")}${row.body.slice(headingEnd)}`;
  }
  const section = renderRelationsSection(relations);
  if (section === "") return row.body;
  const base = row.body === "" ? "" : row.body.endsWith("\n") ? row.body : `${row.body}\n`;
  return `${base}${base === "" ? "" : "\n"}${section}`;
}

export function npcFrontmatter(row: NpcRow): Record<string, unknown> {
  const quickstats = unpackJson(row.quickstats);
  return withExtra(
    compact([
      ["id", row.id],
      ["name", row.name === "" ? row.id : row.name],
      ["role", row.role],
      ["chapter", row.chapterId],
      ["status", row.status === "" ? "unknown" : row.status],
      ["statblock", row.statblock],
      ["quickstats", Object.keys(quickstats).length === 0 ? undefined : quickstats],
      ["voice", row.voice],
      ["appearance", row.appearance],
    ]),
    row.extra,
  );
}

export function renderNpc(
  row: NpcRow,
  relations: Array<{ otherNpcId: string; note: string }>,
): FileResponse {
  return parsed(npcPath(row.id), "npc", npcFrontmatter(row), renderNpcBody(row, relations), row.rev);
}

export function locationFrontmatter(row: LocationRow): Record<string, unknown> {
  return withExtra(
    compact([
      ["id", row.id],
      ["name", row.name === "" ? row.id : row.name],
      ["chapter", row.chapterId],
      ["roll20-page", row.roll20Page],
    ]),
    row.extra,
  );
}

export function renderLocation(row: LocationRow): FileResponse {
  return parsed(locationPath(row.id), "location", locationFrontmatter(row), row.body, row.rev);
}

// --- sessions ---------------------------------------------------------------

export function sessionFrontmatter(
  row: SessionRow,
  pauses: PauseRow[],
  log: LogRow[],
  played: string[],
): Record<string, unknown> {
  const reviewed = log.filter((l) => l.reviewed !== 0).map((l) => l.hash);
  return withExtra(
    compact([
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
    ]),
    row.extra,
  );
}

/**
 * The session body: `## Log` rendered from `log_entries`, then whatever else
 * the session file held (`## Threads` above all), which the migration kept as
 * the row's body.
 */
export function renderSessionBody(row: SessionRow, log: LogRow[]): string {
  const lines = log.map((l) => l.raw).join("\n");
  const logSection = `\n## Log\n${lines === "" ? "" : `\n${lines}\n`}`;
  const rest = row.body.replace(/^\n+/, "");
  return rest === "" ? logSection : `${logSection}\n${rest}`;
}

/**
 * The epoch interpretation of a session's zone-less timestamps — unchanged
 * arithmetic, unchanged reason (issue #40): only the SERVER knows which wall
 * clock those digits belong to, so it ships the reading alongside the
 * strings. `clock.ts` is untouched by the cutover.
 */
export function sessionTimes(
  row: SessionRow,
  pauses: PauseRow[],
): Pick<FileResponse, "startedMs" | "endedMs" | "pausedMs" | "pausedSinceMs"> {
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
): FileResponse {
  const frontmatter = sessionFrontmatter(row, pauses, log, played);
  const body = renderSessionBody(row, log);
  return {
    ...parsed(sessionPath(row.id), "session", frontmatter, body, row.rev),
    ...sessionTimes(row, pauses),
  };
}

// --- inbox ------------------------------------------------------------------

/**
 * The inbox body from its rows, in `pos` order. Every row's `raw` is the line
 * verbatim — including the headings the format's skeleton carries — and a
 * blank line is put after a heading so the rendering reads like the file did.
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

export function renderInbox(campaignId: string, rows: InboxRow[], rev: number): FileResponse {
  // The parser gave a frontmatter-less inbox the file stem as its id; the
  // format's own `inbox.md` carries exactly that.
  return parsed(INBOX_PATH, "inbox", { id: "inbox" }, renderInboxBody(rows), rev);
}

// --- glossary ---------------------------------------------------------------

/**
 * The glossary body from `glossary` rows. A one-line explanation renders as
 * the `EN → DE` list line the format documents; a multi-line one keeps its
 * own `##` section, which is the shape the importer read it out of.
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
): FileResponse {
  return parsed(
    GLOSSARY_PATH,
    "glossary",
    { id: "glossary" },
    renderGlossaryBody(rows, intro),
    rev,
  );
}
