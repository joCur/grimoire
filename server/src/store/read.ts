// The read side of the store: every GET the API answers, as database queries.
//
// The shapes are unchanged — `CampaignSummary[]`, `CampaignTree`,
// `EntryResponse` — and so is every ordering rule the pre-database reader had
// (chapters by their migration order, npcs/locations by name, sessions newest
// first, scene groups by slug). What changed is that the orderings are now
// SQL instead of a directory walk, and that the guard token `rev` is the
// row's own version counter.
//
// The active-session logic is the one piece of behaviour worth calling out:
// it is the SAME definition as before (the last STARTED session that is not
// ended, so a session past midnight stays active), lifted from a newest-first
// directory scan to a query over `sessions`. The shared predicates (`isEnded`)
// still decide, so a blank `ended` still counts as running.

import { and, asc, desc, eq } from "drizzle-orm";
import {
  isEnded,
  isKnowledgeKind,
  type CampaignSummary,
  type CampaignTree,
  type ChapterNode,
  type ChapterStatus,
  type EntryResponse,
  type GlossaryResponse,
  type KnowledgeEntry,
  type KnowledgeResponse,
  type LocationSummary,
  type NpcStatus,
  type NpcSummary,
  type SceneGroup,
  type SceneStatus,
  type SceneSummary,
  type SceneType,
  type InboxResponse,
  type SessionResponse,
  type SessionSummary,
} from "@grimoire/shared";
import { ApiError } from "../api-error";
import { assertSafeCampaignId, assertSafeAddress } from "../addressing";
import { compareSessionsNewestFirst, sessionOrderKey } from "./shared";
import type { GrimoireDb } from "../db/client";
import {
  campaignKnowledge,
  campaigns,
  chapters,
  glossary,
  inboxEntries,
  locations,
  logEntries,
  npcs,
  sceneNpcs,
  sceneTags,
  scenes,
  sessionPauses,
  sessionScenesPlayed,
  sessions,

} from "../db/schema";
import { getDb } from "./handle";
import { expandBodyRefs } from "./refs";
import {
  chapterPath,
  locationPath,
  locatorFromPath,
  npcPath,
  sceneAddress,
  scenePath,
  type Locator,
} from "./paths";
import {
  campaignDisplayName,
  renderCampaign,
  renderChapter,
  renderInbox,
  renderLocation,
  renderNpc,
  renderScene,
  renderSession,
  sessionSummary,
  type CampaignRow,
  type ChapterRow,
  type GlossaryRow,
  type InboxRow,
  type LocationRow,
  type LogRow,
  type NpcRow,
  type PauseRow,
  type SceneRow,
  type SessionRow,
} from "./render";

/** Lexicographic (code-unit) compare — locale-independent, stable. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// --- campaign lookup ---------------------------------------------------------

/**
 * The campaign row; 400 for an unsafe id, 404 when it does not exist. This is
 * the successor of `campaignDir()` and every endpoint starts with it, so an
 * unknown campaign keeps answering 404 exactly as before.
 */
export async function requireCampaign(id: string): Promise<CampaignRow> {
  assertSafeCampaignId(id);
  const db = await getDb();
  const row = campaignRow(db, id);
  if (row === undefined) throw new ApiError(404, "campaign not found");
  return row;
}

export function campaignRow(db: GrimoireDb, id: string): CampaignRow | undefined {
  return db.select().from(campaigns).where(eq(campaigns.id, id)).all()[0] as
    | CampaignRow
    | undefined;
}

/** Current version counter of a campaign (`GET /version`, DECISIONS #9). */
export async function campaignVersion(id: string): Promise<number> {
  return (await requireCampaign(id)).version;
}

// --- GET /api/campaigns ------------------------------------------------------

/**
 * All campaigns with `name`/`description` plus the newest session's id
 * (`lastSession`) and its `started` (`lastSessionStarted`) — which is what
 * lets the app re-open the last active campaign. "Newest" is
 * `compareSessionsNewestFirst`: `started`, then the row's insertion order.
 *
 * The `started` value travels because the id CANNOT be ordered by the client:
 * it is opaque (db/schema.ts). Sorting campaigns by the id string would be
 * sorting random noise.
 *
 * `name` is the campaign's DISPLAY name and therefore always there: an
 * unnamed campaign is shown under its id. This list and `GET /entries/
 * campaign` agree on that: both go through `campaignDisplayName`.
 */
export async function listCampaigns(): Promise<CampaignSummary[]> {
  const db = await getDb();
  const rows = db.select().from(campaigns).orderBy(asc(campaigns.id)).all() as CampaignRow[];
  return rows.map((row) => {
    const summary: CampaignSummary = { id: row.id, name: campaignDisplayName(row) };
    if (row.description !== null && row.description.trim() !== "") {
      summary.description = row.description;
    }
    // Not `max(id)`: session ids are opaque random strings, so
    // there is no order in them at all. The sort needs exactly the three
    // columns `compareSessionsNewestFirst` reads, so the list must NOT pull
    // whole session rows — a campaign with 80 evenings would drag 80 log
    // bodies through this loop for one id.
    const newest = db
      .select({ id: sessions.id, started: sessions.started, createdAt: sessions.createdAt })
      .from(sessions)
      .where(eq(sessions.campaignId, row.id))
      .all()
      .sort(compareSessionsNewestFirst)[0];
    if (newest !== undefined) {
      summary.lastSession = newest.id;
      if (newest.started !== null && newest.started.trim() !== "") {
        summary.lastSessionStarted = newest.started;
      }
    }
    return summary;
  });
}

// --- GET /api/campaigns/:campaign/tree -------------------------------------------------

function sceneSummaryRow(db: GrimoireDb, row: SceneRow): SceneSummary {
  const npcRefs = db
    .select({ npcId: sceneNpcs.npcId })
    .from(sceneNpcs)
    .where(and(eq(sceneNpcs.campaignId, row.campaignId), eq(sceneNpcs.sceneId, row.id)))
    .orderBy(asc(sceneNpcs.pos))
    .all()
    .map((r) => r.npcId);
  const tags = db
    .select({ tag: sceneTags.tag })
    .from(sceneTags)
    .where(and(eq(sceneTags.campaignId, row.campaignId), eq(sceneTags.sceneId, row.id)))
    .orderBy(asc(sceneTags.pos))
    .all()
    .map((r) => r.tag);
  const summary: SceneSummary = {
    path: sceneAddress(row),
    id: row.id,
    title: row.title === "" ? row.id : row.title,
    // Both columns are CHECK constraints over the shared lists (ADR #25), so
    // the stored text is one of their values — the narrowing the row type
    // cannot express.
    type: row.type as SceneType,
    status: row.status as SceneStatus,
    npcs: npcRefs,
    tags,
  };
  if (row.trigger !== null) summary.trigger = row.trigger;
  if (row.location !== null) summary.location = row.location;
  return summary;
}

export async function buildTree(campaign: string): Promise<CampaignTree> {
  await requireCampaign(campaign);
  const db = await getDb();

  const chapterRows = db
    .select()
    .from(chapters)
    .where(eq(chapters.campaignId, campaign))
    .orderBy(asc(chapters.pos), asc(chapters.id))
    .all() as ChapterRow[];

  const sceneRows = db
    .select()
    .from(scenes)
    .where(eq(scenes.campaignId, campaign))
    .orderBy(asc(scenes.pos), asc(scenes.id))
    .all() as SceneRow[];

  // Location id -> display name, for the scene GROUPS below: the heading is
  // the name, so the groups have to be ordered by it.
  const locationRows = db
    .select()
    .from(locations)
    .where(eq(locations.campaignId, campaign))
    .all() as LocationRow[];
  const locationNames = new Map(
    locationRows.map((row) => [row.id, row.name === "" ? row.id : row.name] as const),
  );

  const chapterNodes: ChapterNode[] = chapterRows.map((chapter) => {
    const own = sceneRows.filter((s) => (s.chapterId ?? "") === chapter.id);
    // The group IS the scene's location — "" means the scene
    // names none and renders under the app's neutral "Ohne Ort" section.
    const bySlug = new Map<string, SceneSummary[]>();
    for (const scene of own) {
      const group = scene.location ?? "";
      const list = bySlug.get(group) ?? [];
      list.push(sceneSummaryRow(db, scene));
      bySlug.set(group, list);
    }
    const groups: SceneGroup[] = [...bySlug.entries()]
      .map(([slug, list]) => ({
        slug,
        // A referenced entry always exists (schema.ts rule 3), and an
        // unnamed one degrades to its id — still the word the DM typed.
        name: slug === "" ? "" : (locationNames.get(slug) ?? slug),
        scenes: list.sort((a, b) => cmp(a.path, b.path)),
      }))
      // By the NAME the heading shows, not by the id behind it. "" — the
      // scenes that name no location — goes LAST: it is the leftovers section
      // the app labels „Ohne Ort“, not the first location.
      .sort((a, b) => (a.slug === "" ? 1 : b.slug === "" ? -1 : cmp(a.name, b.name)));
    const node: ChapterNode = {
      id: chapter.id,
      title: chapter.title === "" ? chapter.id : chapter.title,
      groups,
      // A chapter row always exists, so its address is always there; the app
      // uses it to open the chapter entry.
      path: chapterPath(chapter.id),
    };
    if (chapter.status !== null) node.status = chapter.status as ChapterStatus;
    return node;
  });

  const npcList: NpcSummary[] = (
    db.select().from(npcs).where(eq(npcs.campaignId, campaign)).all() as NpcRow[]
  )
    .map((row) => {
      const summary: NpcSummary = {
        path: npcPath(row.id),
        id: row.id,
        name: row.name === "" ? row.id : row.name,
        status: row.status as NpcStatus,
      };
      if (row.role !== null) summary.role = row.role;
      if (row.chapterId !== null) summary.chapter = row.chapterId;
      return summary;
    })
    .sort((a, b) => cmp(a.name, b.name));

  const locationList: LocationSummary[] = locationRows
    .map((row) => {
      const summary: LocationSummary = {
        path: locationPath(row.id),
        id: row.id,
        name: row.name === "" ? row.id : row.name,
      };
      if (row.chapterId !== null) summary.chapter = row.chapterId;
      return summary;
    })
    .sort((a, b) => cmp(a.name, b.name));

  // Newest first, by `started` with the row's insertion time as the tie-break
  // — several sessions per day are possible, and the opaque
  // id orders nothing (compareSessionsNewestFirst).
  const sessionList: SessionSummary[] = sessionSummaries(db, campaign);

  return {
    campaign,
    chapters: chapterNodes,
    npcs: npcList,
    locations: locationList,
    sessions: sessionList,
  };
}

// --- session helpers ---------------------------------------------------------

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

/**
 * GET /api/campaigns/:campaign/inbox — the ideas plus the LIST's guard token.
 * An empty inbox is an empty list, not a missing one (200).
 */
export async function readInbox(campaign: string): Promise<InboxResponse> {
  const row = await requireCampaign(campaign);
  const db = await getDb();
  return renderInbox(inboxRows(db, campaign), row.inboxRev);
}

// --- GET /api/campaigns/:campaign/entries ------------------------------------------------

export function inboxRows(db: GrimoireDb, campaign: string): InboxRow[] {
  return db
    .select({
      pos: inboxEntries.pos,
      text: inboxEntries.text,
      done: inboxEntries.done,
    })
    .from(inboxEntries)
    .where(eq(inboxEntries.campaignId, campaign))
    .orderBy(asc(inboxEntries.pos))
    .all() as InboxRow[];
}

export function glossaryRows(db: GrimoireDb, campaign: string): GlossaryRow[] {
  return db
    .select({
      term: glossary.term,
      explanation: glossary.explanation,
      pos: glossary.pos,
      rev: glossary.rev,
    })
    .from(glossary)
    .where(eq(glossary.campaignId, campaign))
    .orderBy(asc(glossary.pos), asc(glossary.term))
    .all() as GlossaryRow[];
}

/**
 * One `campaign_knowledge` row as it comes out of the table. Its own shape
 * (not `KnowledgeEntry`) because `kind` is whatever the column holds: a row
 * written by an older build, or by hand, degrades to `fact` on the way OUT
 * instead of making the read fail (CLAUDE.md, "Format degradiert").
 */
export interface KnowledgeRow {
  kind: string;
  fromText: string;
  toText: string;
  text: string;
  pos: number;
}

/** The campaign-knowledge list in its stored order. */
export function knowledgeRows(db: GrimoireDb, campaign: string): KnowledgeRow[] {
  return db
    .select({
      kind: campaignKnowledge.kind,
      fromText: campaignKnowledge.fromText,
      toText: campaignKnowledge.toText,
      text: campaignKnowledge.text,
      pos: campaignKnowledge.pos,
    })
    .from(campaignKnowledge)
    .where(eq(campaignKnowledge.campaignId, campaign))
    .orderBy(asc(campaignKnowledge.pos))
    .all() as KnowledgeRow[];
}

/**
 * Render the row a campaign-relative path addresses. 404 when there is no
 * such row — including for a scene whose path names the wrong chapter or
 * group, which is what a stale link is.
 *
 * Only the five ENTRY kinds reach here. A session, the inbox and the glossary
 * have no address (ADR #26), so `locatorFromPath` already answered 404 for
 * them and this switch has no case to spend on a list.
 */
export function readByLocator(
  db: GrimoireDb,
  campaignRowValue: CampaignRow,
  locator: Locator,
): EntryResponse {
  const campaign = campaignRowValue.id;
  switch (locator.kind) {
    case "campaign":
      return renderCampaign(campaignRowValue);
    case "chapter": {
      const row = db
        .select()
        .from(chapters)
        .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, locator.id)))
        .all()[0] as ChapterRow | undefined;
      if (row === undefined) throw new ApiError(404, "entry not found");
      return renderChapter(row);
    }
    case "scene": {
      const row = db
        .select()
        .from(scenes)
        .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, locator.id)))
        .all()[0] as SceneRow | undefined;
      if (row === undefined) throw new ApiError(404, "entry not found");
      // A scene is resolved by its ID alone. The chapter and group segments
      // are not matched: the group is `location` and moves whenever the DM
      // corrects it, so an old link is a STALE ADDRESS for a scene that still
      // exists, not a wrong one. The answer carries the CURRENT address in
      // `path` (renderScene builds it from the row) and
      // the app replaces the URL with it. See ADR #17.
      const summary = sceneSummaryRow(db, row);
      return renderScene(row, summary.npcs, summary.tags);
    }
    case "npc": {
      const row = db
        .select()
        .from(npcs)
        .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, locator.id)))
        .all()[0] as NpcRow | undefined;
      if (row === undefined) throw new ApiError(404, "entry not found");
      return renderNpc(row);
    }
    case "location": {
      const row = db
        .select()
        .from(locations)
        .where(and(eq(locations.campaignId, campaign), eq(locations.id, locator.id)))
        .all()[0] as LocationRow | undefined;
      if (row === undefined) throw new ApiError(404, "entry not found");
      return renderLocation(row);
    }
  }
}

/** GET /api/campaigns/:campaign/entries/<address> */
export async function readEntry(campaign: string, rel: string): Promise<EntryResponse> {
  const row = await requireCampaign(campaign);
  assertSafeAddress(rel); // 400 unsafe id/address
  const db = await getDb();
  return readByLocator(db, row, locatorFromPath(rel));
}

// --- GET /api/campaigns/:campaign/glossary ---------------------------------------------

/**
 * GET /api/campaigns/:campaign/glossary -> `{ entries, rev }`.
 *
 * `rev` travels with it: the settings page edits this list, so it needs the
 * same guard token every other editable thing has. It is the LIST's counter
 * (`campaigns.glossary_rev`) and not `campaigns.version`, which every
 * unrelated write bumps — that would make a glossary edit the DM had open
 * unsaveable during a running session.
 */
export async function readGlossary(campaign: string): Promise<GlossaryResponse> {
  const row = await requireCampaign(campaign);
  const db = await getDb();
  return {
    entries: glossaryRows(db, campaign).map((r) => ({
      term: r.term,
      explanation: r.explanation,
    })),
    rev: row.glossaryRev,
  };
}

/**
 * The glossary as the generator's context block — the `EN → DE` lines the
 * prompt texts (generator.ts).
 */
export async function glossaryText(campaign: string): Promise<string | undefined> {
  const db = await getDb();
  const rows = glossaryRows(db, campaign);
  if (rows.length === 0) return undefined;
  // Same one-line-per-entry guarantee the knowledge lines have (`promptInline`,
  // below): the glossary is quoted into the same prompt and is no more
  // trustworthy as a source of markdown structure.
  return rows
    .map((row) => `- ${promptInline(row.term)} → ${promptInline(row.explanation)}`)
    .join("\n");
}

// --- GET /api/campaigns/:campaign/knowledge --------------------------------------------

/** One stored row as the API shape — an unknown `kind` degrades to `fact`. */
export function knowledgeEntry(row: KnowledgeRow): KnowledgeEntry {
  return {
    kind: isKnowledgeKind(row.kind) ? row.kind : "fact",
    from: row.fromText,
    to: row.toText,
    text: row.text,
  };
}

/** GET /api/campaigns/:campaign/knowledge -> `{ entries, rev }`. */
export async function readKnowledge(campaign: string): Promise<KnowledgeResponse> {
  const row = await requireCampaign(campaign);
  const db = await getDb();
  return {
    entries: knowledgeRows(db, campaign).map(knowledgeEntry),
    rev: row.knowledgeRev,
  };
}

/**
 * The KNOWLEDGE lines of the prompt — the list the generator
 * puts above the glossary, in stored order, one line per entry:
 *
 *     - Namenskonvention: schreibe „Alt“ immer als „Neu“.
 *     - Fakt: <Satz>
 *     - Stilregel: <Satz>
 *
 * German, like the rest of the prompt (llm-provider.ts: the pipeline's target
 * language is German) — this is prompt CONTENT, not UI copy, so it does not
 * belong in the app's catalog.
 *
 * `[[slug]]` references are RESOLVED here with the same expansion the
 * search index uses (store/refs.ts): a fact written as „[[fenn]] lügt immer“
 * must reach the model as „Fenn lügt immer“ — the model has never seen a
 * slug table and would otherwise copy the brackets into the prose.
 *
 * `undefined` when the campaign has no knowledge at all, so the prompt keeps
 * the exact shape it had before this feature.
 */
export async function knowledgeText(campaign: string): Promise<string | undefined> {
  const db = await getDb();
  const rows = knowledgeRows(db, campaign);
  const lines: string[] = [];
  for (const row of rows) {
    const entry = knowledgeEntry(row);
    const resolve = (value: string): string =>
      promptInline(expandBodyRefs(db, campaign, value));
    if (entry.kind === "naming") {
      if (entry.from.trim() === "" || entry.to.trim() === "") continue;
      lines.push(
        `- Namenskonvention: schreibe „${resolve(entry.from)}“ immer als „${resolve(entry.to)}“.`,
      );
      continue;
    }
    if (entry.text.trim() === "") continue;
    const label = entry.kind === "fact" ? "Fakt" : "Stilregel";
    lines.push(`- ${label}: ${resolve(entry.text)}`);
  }
  return lines.length === 0 ? undefined : lines.join("\n");
}

/**
 * The naming conventions as `from`/`to` pairs — the input of the post-run
 * check (naming-check.ts).
 *
 * REF-EXPANDED like the prompt lines: a rule written as
 * „[[fenn]]“ → „Fennwyn“ reaches the model as „Fenn“ → „Fennwyn“, so the
 * check has to search the drafts for „Fenn“ too — searching for the literal
 * „[[fenn]]“ would silently never match and make the rule look obeyed. Both
 * sides are expanded, because `to` is what the check uses to recognise the
 * already-correct spelling (naming-check.ts findRuleHits).
 */
export async function namingRules(campaign: string): Promise<Array<{ from: string; to: string }>> {
  const db = await getDb();
  const expand = (value: string): string =>
    promptInline(expandBodyRefs(db, campaign, value)).trim();
  return knowledgeRows(db, campaign)
    .map(knowledgeEntry)
    .filter((e) => e.kind === "naming" && e.from.trim() !== "" && e.to.trim() !== "")
    .map((e) => ({ from: expand(e.from), to: expand(e.to) }))
    .filter((e) => e.from !== "" && e.to !== "");
}

/**
 * One stored entry as it may appear INSIDE a prompt line.
 *
 * The lists above are assembled into a markdown prompt, so an entry is a
 * fragment of an entry the model reads as instructions. The endpoints
 * already refuse newlines (routes/api.ts), and this is the second half of
 * that: whatever is in the database — a row from an older build, a hand-made
 * one, a value that slipped past a validator — can only ever become ONE line
 * of text here.
 *
 *   * all whitespace collapses to single spaces, so no entry can open a line
 *     of its own;
 *   * a leading „#“ is escaped to „\#“, so no entry can become a HEADING and
 *     pose as a section of the prompt („## Kampagnenwissen“ is the section
 *     the prompt itself writes, and it is binding).
 *
 * Defensive, not decorative: the DM is the only author, but the source text
 * they paste in is not theirs, and an entry is the one place where foreign
 * text is quoted into the instruction half of the prompt.
 */
export function promptInline(value: string): string {
  const flat = value.replace(/\s+/gu, " ").trim();
  return flat.startsWith("#") ? `\\${flat}` : flat;
}
