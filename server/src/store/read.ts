// The read side of the store (issue #57): every GET the API answers, as
// database queries.
//
// The shapes are unchanged — `CampaignSummary[]`, `CampaignTree`,
// `FileResponse` — and so is every ordering rule the file-tree reader had
// (chapters by their migration order, npcs/locations by name, sessions newest
// first, scene groups by slug). What changed is that the orderings are now
// SQL instead of a directory walk, and that `mtimeMs` is the row's `rev`.
//
// The active-session logic is the one piece of behaviour worth calling out:
// it is the SAME definition as before (the last STARTED session that is not
// ended — issue #40, so a session past midnight stays active), lifted from a
// newest-first file scan to a query over `sessions`. The shared predicates
// (`isEnded`) still decide, so a blank `ended` still counts as running.

import { and, asc, desc, eq } from "drizzle-orm";
import {
  isEnded,
  type CampaignSummary,
  type CampaignTree,
  type ChapterNode,
  type FileResponse,
  type LocationSummary,
  type NpcSummary,
  type SceneGroup,
  type SceneSummary,
  type SessionSummary,
} from "@grimoire/shared";
import { ApiError, assertSafeCampaignId, assertSafeRelativeMdPath } from "../campaign-fs";
import { localDateTimeToMs } from "../clock";
import type { GrimoireDb } from "../db/client";
import {
  campaigns,
  chapters,
  glossary,
  inboxEntries,
  locations,
  logEntries,
  migrationReport,
  npcRelations,
  npcs,
  sceneNpcs,
  sceneTags,
  scenes,
  sessionPauses,
  sessionScenesPlayed,
  sessions,

} from "../db/schema";
import { getDb } from "./handle";
import { locatorFromPath, scenePath, type Locator } from "./paths";
import {
  campaignDisplayName,
  renderCampaign,
  renderChapter,
  renderGlossary,
  renderInbox,
  renderLocation,
  renderNpc,
  renderScene,
  renderSession,
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
 * lets the app re-open the last active campaign (issue #14). "Newest" is
 * `compareSessionsNewestFirst`: `started`, then the row's insertion order.
 *
 * The `started` value travels because the id CANNOT be ordered by the client:
 * it is opaque since the PO decision on issue #58 (db/schema.ts). The app used
 * to sort campaigns by the id string and would now be sorting random noise.
 *
 * `name` is the campaign's DISPLAY name and therefore always there: an
 * unnamed campaign is shown under its id. This list and `GET /file?path=
 * _campaign.md` used to disagree about that — the document synthesized the id
 * fallback and the list omitted the key — so the same campaign had two
 * different names depending on which endpoint you asked (issue #62). Both go
 * through `campaignDisplayName` now.
 */
export async function listCampaigns(): Promise<CampaignSummary[]> {
  const db = await getDb();
  const rows = db.select().from(campaigns).orderBy(asc(campaigns.id)).all() as CampaignRow[];
  return rows.map((row) => {
    const summary: CampaignSummary = { id: row.id, name: campaignDisplayName(row) };
    if (row.description !== null && row.description.trim() !== "") {
      summary.description = row.description;
    }
    // Not `max(id)`: session ids are opaque random strings since issue #58, so
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

// --- GET /api/:campaign/tree -------------------------------------------------

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
    path: scenePath(row.chapterId ?? "", row.groupSlug, row.id),
    id: row.id,
    title: row.title === "" ? row.id : row.title,
    type: row.type === "" ? "planned" : row.type,
    status: row.status === "" ? "draft" : row.status,
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

  const chapterNodes: ChapterNode[] = chapterRows.map((chapter) => {
    const own = sceneRows.filter((s) => (s.chapterId ?? "") === chapter.id);
    const bySlug = new Map<string, SceneSummary[]>();
    for (const scene of own) {
      const list = bySlug.get(scene.groupSlug) ?? [];
      list.push(sceneSummaryRow(db, scene));
      bySlug.set(scene.groupSlug, list);
    }
    const groups: SceneGroup[] = [...bySlug.entries()]
      .map(([slug, list]) => ({ slug, scenes: list.sort((a, b) => cmp(a.path, b.path)) }))
      .sort((a, b) => cmp(a.slug, b.slug));
    const node: ChapterNode = {
      id: chapter.id,
      title: chapter.title === "" ? chapter.id : chapter.title,
      groups,
      // `_chapter.md` was optional in the file tree, but a chapter ROW always
      // exists — so the path is always there now. The app only uses it to
      // open the chapter document, which is exactly what it addresses.
      path: `${chapter.id}/_chapter.md`,
    };
    if (chapter.status !== null) node.status = chapter.status;
    return node;
  });

  const npcList: NpcSummary[] = (
    db.select().from(npcs).where(eq(npcs.campaignId, campaign)).all() as NpcRow[]
  )
    .map((row) => {
      const summary: NpcSummary = {
        path: `npcs/${row.id}.md`,
        id: row.id,
        name: row.name === "" ? row.id : row.name,
        status: row.status === "" ? "unknown" : row.status,
      };
      if (row.role !== null) summary.role = row.role;
      if (row.chapterId !== null) summary.chapter = row.chapterId;
      return summary;
    })
    .sort((a, b) => cmp(a.name, b.name));

  const locationList: LocationSummary[] = (
    db.select().from(locations).where(eq(locations.campaignId, campaign)).all() as LocationRow[]
  )
    .map((row) => {
      const summary: LocationSummary = {
        path: `locations/${row.id}.md`,
        id: row.id,
        name: row.name === "" ? row.id : row.name,
      };
      if (row.chapterId !== null) summary.chapter = row.chapterId;
      return summary;
    })
    .sort((a, b) => cmp(a.name, b.name));

  // Newest first, by `started` with the row's insertion time as the tie-break
  // — several sessions per day are possible since issue #58, and the opaque
  // id orders nothing (compareSessionsNewestFirst).
  const sessionList: SessionSummary[] = (
    db.select().from(sessions).where(eq(sessions.campaignId, campaign)).all() as SessionRow[]
  )
    .sort(compareSessionsNewestFirst)
    .map((row) => {
      const summary: SessionSummary = {
        path: `sessions/${row.id}.md`,
        id: row.id,
        scenes_played: playedScenes(db, campaign, row.id),
      };
      if (row.started !== null) summary.started = row.started;
      if (row.ended !== null) summary.ended = row.ended;
      return summary;
    });

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
      raw: logEntries.raw,
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

/** The only three session columns the ordering rule below looks at. */
export type SessionOrderFields = Pick<SessionRow, "id" | "started" | "createdAt">;

/**
 * Chronological order key of a session in epoch milliseconds, or undefined
 * when the row says nothing usable about WHEN it started.
 *
 * `started` is the ONLY source. The id used to serve as a fallback while it
 * was date-shaped; since the PO decision on issue #58 it is an opaque random
 * string (db/schema.ts) and there is nothing in it to read. A row without a
 * usable `started` therefore wins nothing — same as before for a row that had
 * neither.
 *
 * Takes only the columns it reads, so callers that need nothing else of a
 * session (the campaign list) can select just those.
 */
export function sessionOrderKey(row: Pick<SessionOrderFields, "started">): number | undefined {
  return localDateTimeToMs(row.started);
}

/**
 * Newest-first comparator: `started` decides, and `createdAt` — the row's
 * insertion time in milliseconds — breaks the tie. Two sessions of the same
 * evening can share a `started` to the SECOND (start, end, start again —
 * issue #58), and "the last started one" has to be the second of them,
 * deterministically. The opaque id cannot say which came first, so the row
 * records it.
 *
 * Last resort for two rows that share both (migrated rows carry `createdAt`
 * 0): a plain string compare of the ids. Which of them then counts as newer
 * is arbitrary — but it is STABLE, and that is the property callers need.
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

function pickLatest(rows: SessionRow[]): SessionRow | undefined {
  const candidates = rows.filter((row) => sessionOrderKey(row) !== undefined);
  if (candidates.length === 0) return undefined;
  return [...candidates].sort(compareSessionsNewestFirst)[0];
}

/**
 * The ACTIVE session row: the last STARTED one that is not ended. With
 * `includeEnded` it is simply the last started session — the file the review
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
): FileResponse {
  return renderSession(
    row,
    pauseRows(db, campaign, row.id),
    logRows(db, campaign, row.id),
    playedScenes(db, campaign, row.id),
  );
}

/**
 * GET /api/:campaign/session — the active session; 404 when none runs. With
 * `includeEnded` the last started session even if ended (404 only when the
 * campaign has no session at all).
 */
export async function readActiveSession(
  campaign: string,
  includeEnded = false,
): Promise<FileResponse> {
  await requireCampaign(campaign);
  const db = await getDb();
  const row = pickSession(db, campaign, includeEnded);
  if (row === undefined) {
    throw new ApiError(404, includeEnded ? "no session yet" : "no active session");
  }
  return renderSessionRow(db, campaign, row);
}

// --- GET /api/:campaign/file -------------------------------------------------

export function inboxRows(db: GrimoireDb, campaign: string): InboxRow[] {
  return db
    .select({
      pos: inboxEntries.pos,
      raw: inboxEntries.raw,
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

export function relationRows(
  db: GrimoireDb,
  campaign: string,
  npcId: string,
): Array<{ otherNpcId: string; note: string }> {
  return db
    .select({ otherNpcId: npcRelations.otherNpcId, note: npcRelations.note })
    .from(npcRelations)
    .where(and(eq(npcRelations.campaignId, campaign), eq(npcRelations.npcId, npcId)))
    .orderBy(asc(npcRelations.pos))
    .all();
}

/**
 * Render the row a campaign-relative path addresses. 404 when there is no
 * such row — including for a scene whose path names the wrong chapter or
 * group, which is what a stale link is.
 */
export function readByLocator(
  db: GrimoireDb,
  campaignRowValue: CampaignRow,
  locator: Locator,
): FileResponse {
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
      if (row === undefined) throw new ApiError(404, "file not found");
      return renderChapter(row);
    }
    case "scene": {
      const row = db
        .select()
        .from(scenes)
        .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, locator.id)))
        .all()[0] as SceneRow | undefined;
      if (row === undefined) throw new ApiError(404, "file not found");
      if ((row.chapterId ?? "") !== locator.chapterId || row.groupSlug !== locator.groupSlug) {
        throw new ApiError(404, "file not found");
      }
      const summary = sceneSummaryRow(db, row);
      return renderScene(row, summary.npcs, summary.tags);
    }
    case "npc": {
      const row = db
        .select()
        .from(npcs)
        .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, locator.id)))
        .all()[0] as NpcRow | undefined;
      if (row === undefined) throw new ApiError(404, "file not found");
      return renderNpc(row, relationRows(db, campaign, row.id));
    }
    case "location": {
      const row = db
        .select()
        .from(locations)
        .where(and(eq(locations.campaignId, campaign), eq(locations.id, locator.id)))
        .all()[0] as LocationRow | undefined;
      if (row === undefined) throw new ApiError(404, "file not found");
      return renderLocation(row);
    }
    case "session": {
      const row = sessionRow(db, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "file not found");
      return renderSessionRow(db, campaign, row);
    }
    case "inbox": {
      const rows = inboxRows(db, campaign);
      // Neither the inbox nor the glossary is a single row that could carry a
      // `rev`, so each has its own counter on the campaign row
      // (`inbox_rev` / `glossary_rev`, schema.ts). `version` used to stand in
      // for both, and because EVERY write bumps that, one unrelated log line
      // invalidated a glossary edit the DM had open — un-saveable during a
      // running session. A content hash would be the unsafe fix (two
      // different edits can hash alike); a per-document counter is the exact
      // one.
      if (rows.length === 0) throw new ApiError(404, "file not found");
      return renderInbox(campaign, rows, campaignRowValue.inboxRev);
    }
    case "glossary":
      // An EMPTY glossary is an empty document, not a missing one (200). The
      // 404 it used to answer was a trap: saving an empty body through the
      // editor made the file the editor was in unreachable.
      return renderGlossary(
        glossaryRows(db, campaign),
        campaignRowValue.glossaryRev,
        campaignRowValue.glossaryIntro,
      );
  }
}

/** GET /api/:campaign/file?path=… */
export async function readParsedFile(campaign: string, rel: string): Promise<FileResponse> {
  const row = await requireCampaign(campaign);
  assertSafeRelativeMdPath(rel); // 400 unsafe id/path
  const db = await getDb();
  return readByLocator(db, row, locatorFromPath(rel));
}

// --- GET /api/:campaign/migration-report -------------------------------------

export interface MigrationReportEntry {
  path: string;
  reason: string;
  at: string;
}

/**
 * Everything the one-time migration had to degrade, oldest first (planning
 * section 3). An EMPTY list is the success criterion of a clean import; a
 * non-empty one is a reading task for the DM, which is why the app shows a
 * quiet hint when there is anything here.
 */
export async function readMigrationReport(campaign: string): Promise<MigrationReportEntry[]> {
  await requireCampaign(campaign);
  const db = await getDb();
  return db
    .select({
      path: migrationReport.path,
      reason: migrationReport.reason,
      at: migrationReport.at,
    })
    .from(migrationReport)
    .where(eq(migrationReport.campaignId, campaign))
    .orderBy(asc(migrationReport.id))
    .all();
}

// --- GET /api/:campaign/glossary ---------------------------------------------

export interface GlossaryEntry {
  term: string;
  explanation: string;
}

/** GET /api/:campaign/glossary -> `{ entries }` (planning section 2). */
export async function readGlossary(campaign: string): Promise<{ entries: GlossaryEntry[] }> {
  await requireCampaign(campaign);
  const db = await getDb();
  return {
    entries: glossaryRows(db, campaign).map((row) => ({
      term: row.term,
      explanation: row.explanation,
    })),
  };
}

/**
 * The glossary as the generator's context block — the `EN → DE` lines the
 * prompt documents. Replaces reading `glossary.md` off disk (generator.ts).
 */
export async function glossaryText(campaign: string): Promise<string | undefined> {
  const db = await getDb();
  const rows = glossaryRows(db, campaign);
  if (rows.length === 0) return undefined;
  return rows.map((row) => `- ${row.term} → ${row.explanation}`).join("\n");
}

