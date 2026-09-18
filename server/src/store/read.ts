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
  isKnowledgeKind,
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
  type SessionSummary,
} from "@grimoire/shared";
import { ApiError } from "../api-error";
import { assertSafeAddress } from "../addressing";
import { requireCampaign } from "./campaigns";
import { sessionSummaries } from "./session-rows";
import type { GrimoireDb } from "../db/client";
import {
  campaignKnowledge,
  chapters,
  glossary,
  locations,
  npcs,
  sceneNpcs,
  sceneTags,
  scenes,
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
  renderCampaign,
  renderChapter,
  renderLocation,
  renderNpc,
  renderScene,
  type CampaignRow,
  type ChapterRow,
  type GlossaryRow,
  type LocationRow,
  type NpcRow,
  type SceneRow,
} from "./render";

/** Lexicographic (code-unit) compare — locale-independent, stable. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
