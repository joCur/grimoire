// Chapters and the scenes in them.
//
// A scene lives here rather than in a module of its own: its chapter and its
// location are its ADDRESS (ADR #17), so creating one, moving one and listing
// the tree are all statements about a chapter. This module builds that tree,
// creates chapters and scenes, holds the one-active-chapter rule and appends
// to a chapter's `## Offene Fäden`.

import { and, asc, eq } from "drizzle-orm";
import {
  ENTITY_SLUG,
  freeSlug,
  toSlug,
  type CampaignTree,
  type ChapterNode,
  type ChapterStatus,
  type EntryResponse,
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
import type { GrimoireDb } from "../db/client";
import { chapters, locations, npcs, sceneNpcs, sceneTags, scenes } from "../db/schema";
import { mutate, requireCampaign } from "./campaigns";
import { chapterIdExists, chapterRowOf, indexChapter, indexScene, sceneRowOf } from "./entity-rows";
import { getDb } from "./handle";
import { chapterPath, locationPath, npcPath, sceneAddress, RESERVED_SEGMENTS } from "./paths";
import {
  renderChapter,
  renderScene,
  type ChapterRow,
  type LocationRow,
  type NpcRow,
  type SceneRow,
} from "./render";
import { sessionSummaries } from "./session-rows";
import {
  asOptStr,
  assertSafeChapterId,
  nextPos,
  resolveNewId,
  slugReserved,
  slugTaken,
  unknownRef,
} from "./shared";

// --- chapter status ----------------------------------------------------------

/**
 * The ONE chapter status the app acts on (the overview's control, the session
 * view's "which chapter is running"). There is at most one per campaign, and
 * every write that sets it clears the previous one in the same transaction.
 */
export const CHAPTER_ACTIVE = "active";

/**
 * Where a chapter starts, and where the swap puts the one it takes `active`
 * from. Not NULL: the overview renders a chapter's status and nothing renders
 * nothing, so a chapter without one would look less planned than its
 * siblings. A NULL only survives on an older chapter, which the app reads as
 * `planned`.
 */
const CHAPTER_PLANNED = "planned";

/**
 * Take `active` off every OTHER chapter of the campaign — the swap half of
 * "exactly one active chapter".
 *
 * Both writes that can set `active` call this inside their own transaction:
 * `POST /chapters/:id/active` (the overview's status control) and an entry
 * PATCH whose status ends up `active` (the chapter properties dialog). The
 * invariant belongs to the COLUMN, not to one endpoint — otherwise the
 * dialog is a second door past it.
 */
export function clearOtherActiveChapters(tx: GrimoireDb, campaign: string, keep: string): void {
  const previous = tx
    .select()
    .from(chapters)
    .where(and(eq(chapters.campaignId, campaign), eq(chapters.status, CHAPTER_ACTIVE)))
    .all() as ChapterRow[];
  for (const row of previous) {
    if (row.id === keep) continue;
    tx.update(chapters)
      .set({ status: CHAPTER_PLANNED, rev: row.rev + 1 })
      .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, row.id)))
      .run();
  }
}

// --- a scene's location, which is also its group ------------------------------

/**
 * A scene's `location`, validated: an entity id, or null.
 *
 * `location` is a REFERENCE — it is the scene's group and its address — so a
 * value that cannot be an id cannot be a group either. Free text is a 400
 * that carries the slug it would have been, so the app can say which id to
 * use; whether that id HAS an entry is the next question
 * (`assertLocationRef`).
 */
export function sceneLocation(value: unknown): string | null {
  const raw = asOptStr(value);
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!ENTITY_SLUG.test(trimmed)) {
    const suggestion = toSlug(trimmed);
    throw new ApiError(
      400,
      `location "${trimmed}" is not a location id — a scene's location is a reference` +
        (suggestion === "" ? "" : `; use "${suggestion}" and create that location first`),
      suggestion === ""
        ? { code: "location_not_an_id", value: trimmed }
        : { code: "location_not_an_id", value: trimmed, suggestion },
    );
  }
  return trimmed;
}

/**
 * Replace a scene's reference rows. The caller has checked the npc ids
 * (`assertNpcRefs`); the rows are deleted and rewritten because `pos` — the
 * authored order — is part of the content.
 */
export function replaceSceneRefs(
  tx: GrimoireDb,
  campaign: string,
  sceneId: string,
  npcRefs: string[],
  tags: string[],
): void {
  tx.delete(sceneNpcs)
    .where(and(eq(sceneNpcs.campaignId, campaign), eq(sceneNpcs.sceneId, sceneId)))
    .run();
  const seenNpcs = new Set<string>();
  npcRefs.forEach((npcId, pos) => {
    if (npcId === "" || seenNpcs.has(npcId)) return;
    seenNpcs.add(npcId);
    tx.insert(sceneNpcs).values({ campaignId: campaign, sceneId, npcId, pos }).run();
  });
  tx.delete(sceneTags)
    .where(and(eq(sceneTags.campaignId, campaign), eq(sceneTags.sceneId, sceneId)))
    .run();
  const seenTags = new Set<string>();
  tags.forEach((tag, pos) => {
    if (tag === "" || seenTags.has(tag)) return;
    seenTags.add(tag);
    tx.insert(sceneTags).values({ campaignId: campaign, sceneId, tag, pos }).run();
  });
}

// --- reading a chapter or a scene entry ---------------------------------------

/**
 * The chapter entry an address names; 404 when the campaign has no chapter
 * with that id.
 */
export function readChapterEntry(
  tx: GrimoireDb,
  campaign: string,
  id: string,
): EntryResponse {
  const row = chapterRowOf(tx, campaign, id);
  if (row === undefined) throw new ApiError(404, "entry not found");
  return renderChapter(row);
}

/**
 * The scene entry an address names; 404 when the campaign has no scene with
 * that id.
 *
 * A scene is resolved by its ID alone. The chapter and group segments of the
 * address are not matched: the group is `location`, and it moves whenever the
 * DM corrects it, so an old link is a STALE ADDRESS for a scene that still
 * exists, not a wrong one. The answer carries the CURRENT address in `path`
 * (renderScene builds it from the row) and the app replaces the URL with it.
 * See ADR #17.
 */
export function readSceneEntry(tx: GrimoireDb, campaign: string, id: string): EntryResponse {
  const row = sceneRowOf(tx, campaign, id);
  if (row === undefined) throw new ApiError(404, "entry not found");
  const summary = sceneSummaryRow(tx, row);
  return renderScene(row, summary.npcs, summary.tags);
}

// --- GET /api/campaigns/:campaign/tree ----------------------------------------

/** Lexicographic (code-unit) compare — locale-independent, stable. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sceneSummaryRow(db: GrimoireDb, row: SceneRow): SceneSummary {
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

// --- creating a chapter and a scene -------------------------------------------

/** True when the campaign has a chapter with this id (generator target check). */
export async function chapterExists(campaign: string, chapter: string): Promise<boolean> {
  const db = await getDb();
  return chapterRowOf(db, campaign, chapter) !== undefined;
}

/**
 * POST /api/campaigns/:campaign/chapters { title, goal? } -> the chapter entry.
 *
 * `goal` is optional and lands under `## Ziel des Kapitels` — the heading the
 * chapter overview reads its goal line from (routes/chapter-overview.tsx). Without it the body stays
 * empty rather than carrying an empty section.
 */
export async function createChapter(
  campaign: string,
  title: string,
  goal?: string,
  explicitId?: string,
): Promise<EntryResponse> {
  const id = resolveNewId(explicitId, title, "chapter", "title");
  assertSafeChapterId(id);
  // A reserved id would create an unreachable chapter (store/shared.ts).
  // Both guards share one "is this id available" predicate, so the proposal
  // cannot land on a reserved id either.
  return mutate(campaign, (tx) => {
    const unavailable = (candidate: string): boolean =>
      RESERVED_SEGMENTS.has(candidate) || chapterRowOf(tx, campaign, candidate) !== undefined;
    if (RESERVED_SEGMENTS.has(id)) {
      throw slugReserved("chapter", id, freeSlug(id, unavailable));
    }
    if (chapterRowOf(tx, campaign, id) !== undefined) {
      throw slugTaken("chapter", id, freeSlug(id, unavailable), chapterPath(id));
    }
    const trimmedGoal = goal?.trim() ?? "";
    const body = trimmedGoal === "" ? "" : `## Ziel des Kapitels\n\n${trimmedGoal}\n`;
    tx.insert(chapters)
      .values({
        campaignId: campaign,
        id,
        title: title.trim(),
        // A chapter is born `planned`, like the one `ensureChapterRow`
        // creates: the status has three positions now, and every chapter
        // should start at one the DM can read instead of at none at all.
        status: CHAPTER_PLANNED,
        body,
        pos: nextPos(
          tx.select({ pos: chapters.pos }).from(chapters).where(eq(chapters.campaignId, campaign)).all(),
        ),
      })
      .run();
    const row = chapterRowOf(tx, campaign, id);
    if (row === undefined) throw new ApiError(500, "chapter could not be created");
    indexChapter(tx, campaign, row);
    return renderChapter(row);
  });
}

/**
 * POST /api/campaigns/:campaign/chapters/:id/active -> the chapter entry.
 *
 * The active state in the overview's status control. ONE call, ONE transaction,
 * because it is ONE decision about two chapters: the one named here becomes
 * `active` and whatever was active before goes back to `planned`. Two
 * requests from the app would have a window in which the campaign has two
 * active chapters — and the session view picks the FIRST one it finds, so
 * that window is a wrong session view, not a cosmetic race.
 *
 * The swap itself is `clearOtherActiveChapters`, which an entry PATCH
 * setting `active` runs too: the rule belongs to the column, not to this
 * endpoint. Every other status a chapter carries is left alone — this action
 * decides which chapter is active, nothing else.
 *
 * NO rev guard, deliberately, and it is the one write here without one: there
 * is nothing to overwrite. The overview shows no rev (the tree carries none),
 * the action sets a value rather than editing text, and its whole point is
 * that it also changes a chapter the caller never read. Two racing callers end
 * with one active chapter either way — which is the rule that matters.
 * The entry PATCH of a chapter keeps its rev guard, so the properties
 * dialog is a guarded write that happens to also swap.
 *
 * 404 for a chapter that does not exist; idempotent for one that is already
 * active.
 */
export async function setActiveChapter(campaign: string, id: string): Promise<EntryResponse> {
  assertSafeChapterId(id);
  return mutate(campaign, (tx) => {
    const target = chapterRowOf(tx, campaign, id);
    if (target === undefined) throw new ApiError(404, `unknown chapter: ${id}`);
    clearOtherActiveChapters(tx, campaign, id);
    if (target.status !== CHAPTER_ACTIVE) {
      tx.update(chapters)
        .set({ status: CHAPTER_ACTIVE, rev: target.rev + 1 })
        .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, id)))
        .run();
    }
    const row = chapterRowOf(tx, campaign, id);
    if (row === undefined) throw new ApiError(500, "chapter could not be updated");
    indexChapter(tx, campaign, row);
    return renderChapter(row);
  });
}

/**
 * POST /api/campaigns/:campaign/scenes { title, chapter } -> the scene entry.
 *
 * The chapter is REQUIRED and has to exist (400 otherwise): a scene's chapter
 * is part of its address, and a scene under an unknown chapter has no node to
 * hang in — the same rule `assertChapterRef` enforces for a properties patch,
 * and the same code (ADR #19, a mention creates nothing).
 *
 * A scene created here has no `location`, so it sits at chapter level and
 * the app lists it in its no-location group. Setting one later is an
 * ordinary entry PATCH — and that patch is also what moves the scene into
 * the location's group, address included.
 */
export async function createScene(
  campaign: string,
  title: string,
  chapter: string,
  explicitId?: string,
): Promise<EntryResponse> {
  const id = resolveNewId(explicitId, title, "scene", "title");
  assertSafeChapterId(chapter);
  return mutate(campaign, (tx) => {
    if (!chapterIdExists(tx, campaign, chapter)) {
      throw unknownRef("chapter_unknown", "chapter", chapter);
    }
    const existing = sceneRowOf(tx, campaign, id);
    if (existing !== undefined) {
      const suggestion = freeSlug(
        id,
        (candidate) => sceneRowOf(tx, campaign, candidate) !== undefined,
      );
      throw slugTaken(
        "scene",
        id,
        suggestion,
        sceneAddress({
          chapterId: existing.chapterId ?? chapter,
          location: existing.location,
          id: existing.id,
        }),
      );
    }
    tx.insert(scenes)
      .values({
        campaignId: campaign,
        id,
        chapterId: chapter,
        title: title.trim(),
        pos: nextPos(
          tx.select({ pos: scenes.pos }).from(scenes).where(eq(scenes.campaignId, campaign)).all(),
        ),
      })
      .run();
    const row = sceneRowOf(tx, campaign, id);
    if (row === undefined) throw new ApiError(500, "scene could not be created");
    indexScene(tx, campaign, row, []);
    return renderScene(row, [], []);
  });
}

/**
 * The chapter of a GENERATED scene, created if it has none of its own.
 *
 * The ONE write that brings an entry into existence without the DM naming it
 * in a dialog, and it is not a mention creating anything: the run itself
 * decided the chapter (and, for a new-chapter run, its title), so
 * accepting the proposal has to be able to write it. Without this a scene
 * ends up under a chapter that has no entry — and the overview lists
 * chapters, so the chapter and every scene in it would be unreachable.
 *
 * Idempotent and quiet: false when the chapter is already there, and false
 * for an id that is no entity slug — `assertChapterRef` then answers for it.
 * `planned` like every other creation path: a chapter the run brought is
 * upcoming, never the active one.
 */
export function ensureChapterRow(
  tx: GrimoireDb,
  campaign: string,
  id: string,
  title?: string,
): boolean {
  if (!ENTITY_SLUG.test(id)) return false;
  if (chapterRowOf(tx, campaign, id) !== undefined) return false;
  const display = title?.trim();
  tx.insert(chapters)
    .values({
      campaignId: campaign,
      id,
      title: display === undefined || display === "" ? id : display,
      status: CHAPTER_PLANNED,
      pos: nextPos(
        tx.select({ pos: chapters.pos }).from(chapters).where(eq(chapters.campaignId, campaign)).all(),
      ),
    })
    .run();
  const row = chapterRowOf(tx, campaign, id);
  if (row !== undefined) indexChapter(tx, campaign, row);
  return true;
}

// --- the review's open threads ------------------------------------------------

/**
 * Append one item to the `## Offene Fäden` section of a chapter body — the
 * item goes to the end of the section, a missing section is created at the
 * end of the body, and only the seam's blank lines are adjusted.
 */
export function appendThreadItem(body: string, item: string): string {
  const heading = /^## Offene Fäden[ \t]*\r?$/m.exec(body);
  if (heading === null) {
    let base = body;
    if (base.length > 0 && !base.endsWith("\n")) base += "\n";
    if (base.length > 0 && !base.endsWith("\n\n")) base += "\n";
    return `${base}## Offene Fäden\n\n${item}\n`;
  }
  const nlAfterHeading = body.indexOf("\n", heading.index);
  const sectionStart = nlAfterHeading === -1 ? body.length : nlAfterHeading + 1;
  const nextHeading = /^#{1,6}[ \t]/m.exec(body.slice(sectionStart));
  const sectionEnd = nextHeading === null ? body.length : sectionStart + nextHeading.index;
  const section = body.slice(sectionStart, sectionEnd).replace(/\s+$/, "");
  const newSection = section === "" ? `\n${item}\n` : `${section}\n${item}\n`;
  const rest = body.slice(sectionEnd);
  return body.slice(0, sectionStart) + newSection + (rest === "" ? "" : `\n${rest}`);
}

/**
 * POST /api/campaigns/:campaign/review/thread — append `- [ ] text` under
 * `## Offene Fäden` of the chapter. 404 for an unknown chapter — the chapter
 * ROW has to exist.
 */
export async function appendThreadToChapter(
  campaign: string,
  chapter: string,
  text: string,
): Promise<EntryResponse> {
  assertSafeChapterId(chapter);
  return mutate(campaign, (tx) => {
    const row = chapterRowOf(tx, campaign, chapter);
    if (row === undefined) throw new ApiError(404, "chapter not found");
    const next: ChapterRow = {
      ...row,
      body: appendThreadItem(row.body, `- [ ] ${text}`),
      rev: row.rev + 1,
    };
    tx.update(chapters)
      .set({ body: next.body, rev: next.rev })
      .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, chapter)))
      .run();
    indexChapter(tx, campaign, next);
    return renderChapter(next);
  });
}
