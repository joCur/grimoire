// Chapters: the chapter resource, the campaign tree, and the order of the
// scenes in a chapter.
//
// The chapter is its own resource with its own type (ADR #31,
// @grimoire/shared/chapter): read, listed, written, created and taken over
// from a proposal here, typed by its one zod schema, and this module holds
// the one-active-chapter rule every write that sets `active` runs. Beside it
// stand the campaign tree — a shape that shows several entities and belongs
// to its endpoint — and the order of a chapter's scenes: the chapter's
// statement about its scenes, with its own guard (ADR #27). A scene itself
// is its own resource (./scenes.ts), and a chapter's open threads are a list
// of their own (./threads.ts).

import { and, asc, eq } from "drizzle-orm";
import {
  chapterCreateSchema,
  chapterPatchSchema,
  chapterProposalSchema,
  ENTITY_SLUG,
  freeSlug,
  type CampaignTree,
  type Chapter,
  type ChapterCreate,
  type ChapterNode,
  type ChapterPatch,
  type ChapterProposal,
  type ChapterStatus,
  type LocationSummary,
  type NpcStatus,
  type NpcSummary,
  type SceneOrderResponse,
  type SceneStatus,
  type SceneSummary,
  type SceneType,
  type SessionSummary,
} from "@grimoire/shared";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { chapters, locations, npcs, scenes } from "../db/schema";
import { mutate, requireCampaign } from "./campaigns";
import { chapterRowOf, indexChapter, refNpcs, refTags } from "./entity-rows";
import { getDb } from "./handle";
import type { ChapterRow, LocationRow, NpcRow, SceneRow } from "./render";
import { sessionSummaries } from "./session-rows";
import {
  assertChapterStatus,
  assertSafeChapterId,
  guardRev,
  nextPos,
  normalizeBody,
  parseRequest,
  resolveNewId,
  revConflict,
  slugTaken,
} from "./shared";

// --- the one active chapter ---------------------------------------------------

/**
 * The ONE chapter status the app acts on (the overview's control, the session
 * view's "which chapter is running"). There is at most one per campaign, and
 * every write that sets it takes it off the previous one in the same
 * transaction.
 */
const CHAPTER_ACTIVE = "active";

/**
 * Where a chapter starts, and where the swap puts the one it takes `active`
 * from. Not NULL: the overview renders a chapter's status and nothing renders
 * nothing, so a chapter without one would look less planned than its
 * siblings. A NULL only survives on an older chapter, which the app reads as
 * `planned`.
 */
const CHAPTER_PLANNED = "planned";

/**
 * Take `active` off every OTHER chapter of the campaign and put it back to
 * `planned` — the swap half of "at most one active chapter". Each of those
 * chapters is written, so its `rev` moves with it: an editor open on it sees
 * that it changed.
 *
 * Every write that can make a chapter active calls this inside its own
 * transaction — the PATCH, the create, and taking over a chapter proposal —
 * because the rule belongs to the COLUMN, not to one endpoint.
 */
function clearOtherActiveChapters(tx: GrimoireDb, campaign: string, keep: string): void {
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

// --- the order of the scenes in a chapter ------------------------------------

/**
 * The `pos` a scene appended to `chapter` gets: one past the last scene of
 * THAT chapter.
 *
 * Per chapter, not per campaign: a chapter lists its own scenes and nothing
 * else, so a campaign-wide counter would hand out positions that grow with
 * the campaign while saying nothing about where the scene sits among its
 * siblings. Every path that brings a scene into a chapter uses this one —
 * creating it, moving one here from another chapter, and accepting a
 * generated scene, which uses it through the run's start below.
 */
export function nextScenePos(tx: GrimoireDb, campaign: string, chapter: string): number {
  return nextPos(
    tx
      .select({ pos: scenes.pos })
      .from(scenes)
      .where(and(eq(scenes.campaignId, campaign), eq(scenes.chapterId, chapter)))
      .all(),
  );
}

/**
 * Where the scenes of ONE generator run are placed from (ADR #27): the
 * chapter's end at the run's first scene accept, and the chapter's order
 * guard at that moment. It is taken once and stored on the run, so a scene
 * accepted later still lands at its outline place instead of behind whatever
 * the earlier accepts appended.
 */
export interface SceneRunStart {
  pos: number;
  sceneOrderRev: number;
}

/** Take a run's start now — before any scene of that run is in the chapter. */
export function takeSceneRunStart(
  tx: GrimoireDb,
  campaign: string,
  chapter: string,
): SceneRunStart {
  return {
    pos: nextScenePos(tx, campaign, chapter),
    sceneOrderRev: chapterRowOf(tx, campaign, chapter)?.sceneOrderRev ?? 0,
  };
}

/**
 * The `pos` of the run's scene with outline number `number`: the start plus
 * that number, so accepting the scenes in any order and across any number of
 * calls ends in outline order. A dropped or failed scene keeps its number and
 * leaves a gap — `pos` is a sort key, not an index.
 *
 * Once the DM has reordered the chapter by hand (its `scene_order_rev` moved
 * past the start's), the hand order wins: the order write has handed out
 * dense positions the start knows nothing about, so every further scene of
 * the run is appended at the end like any other new scene. There is no new
 * start either — a second one would only re-sort around the DM's order.
 *
 * Two equal positions are possible only when the DM created a scene by hand
 * during the review; the chapter lists by `pos, id`, so that tie needs no
 * rule of its own.
 */
export function sceneRunPos(
  tx: GrimoireDb,
  campaign: string,
  chapter: string,
  start: SceneRunStart,
  number: number,
): number {
  const current = chapterRowOf(tx, campaign, chapter)?.sceneOrderRev;
  return current === start.sceneOrderRev
    ? start.pos + number
    : nextScenePos(tx, campaign, chapter);
}

/**
 * The 400 of a scene-order write whose list is not exactly the chapter's
 * scenes. It names all three ways it can be wrong at once, so the DM sees
 * the whole mismatch rather than the first id of it.
 */
function sceneOrderMismatch(
  missing: string[],
  unknown: string[],
  duplicate: string[],
): ApiError {
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
  if (unknown.length > 0) parts.push(`not in this chapter: ${unknown.join(", ")}`);
  if (duplicate.length > 0) parts.push(`listed twice: ${duplicate.join(", ")}`);
  return new ApiError(
    400,
    `the order must name exactly the scenes of this chapter (${parts.join("; ")})`,
    { code: "scene_order_mismatch", missing, unknown, duplicate },
  );
}

/**
 * PUT /api/campaigns/:campaign/chapters/:chapter/scene-order
 * `{ scenes, rev }` -> the stored order plus the order's fresh guard token.
 *
 * The whole order in one request, like the glossary's list write: dragging a
 * scene changes the positions of its neighbours too, so the array IS the
 * order and there is no per-scene "move" to race against.
 *
 * THE GUARD IS `chapters.scene_order_rev`, a counter of its own, and the
 * write bumps only that one. Neither `chapters.rev` nor `scenes.rev` moves:
 * those guard a chapter's fields and a scene's fields (ADR #23), and
 * reordering touches none of them.
 * Bumping either would turn an editor that is open on something else into a
 * conflict the moment somebody rearranges the chapter around it, which is a
 * write that editor is not competing with. The order is its own list with
 * its own lifetime, so it counts its own writes, exactly like the three list
 * guards on `campaigns`.
 *
 * The list has to be EXACTLY the chapter's scenes — a missing, a foreign or
 * a repeated id is 400 `scene_order_mismatch` and nothing is written. A
 * partial order would have to invent positions for the scenes it does not
 * mention, and inventing is the thing this endpoint exists to stop.
 */
export async function writeSceneOrder(
  campaign: string,
  chapter: string,
  order: string[],
  rev: number,
): Promise<SceneOrderResponse> {
  assertSafeChapterId(chapter);
  return mutate(campaign, (tx) => {
    const chapterRow = chapterRowOf(tx, campaign, chapter);
    if (chapterRow === undefined) throw new ApiError(404, "chapter not found");
    guardRev(chapterRow.sceneOrderRev, rev, "scene order changed");

    const present = new Set(
      tx
        .select({ id: scenes.id })
        .from(scenes)
        .where(and(eq(scenes.campaignId, campaign), eq(scenes.chapterId, chapter)))
        .all()
        .map((r) => r.id),
    );
    const seen = new Set<string>();
    const unknown: string[] = [];
    const duplicate: string[] = [];
    for (const id of order) {
      if (seen.has(id)) {
        if (!duplicate.includes(id)) duplicate.push(id);
        continue;
      }
      seen.add(id);
      if (!present.has(id)) unknown.push(id);
    }
    const missing = [...present].filter((id) => !seen.has(id)).sort(cmp);
    if (missing.length > 0 || unknown.length > 0 || duplicate.length > 0) {
      throw sceneOrderMismatch(missing, unknown, duplicate);
    }

    order.forEach((id, pos) => {
      tx.update(scenes)
        .set({ pos })
        .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, id)))
        .run();
    });
    const nextRev = chapterRow.sceneOrderRev + 1;
    tx.update(chapters)
      .set({ sceneOrderRev: nextRev })
      .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, chapter)))
      .run();
    return { scenes: [...order], rev: nextRev };
  });
}

// --- rendering a row ----------------------------------------------------------

/**
 * The chapter of a row. An empty title falls back to the id — the same
 * display-name rule as everywhere — and a status that holds nothing is a
 * field the chapter does not carry. The body travels exactly as it is
 * stored.
 */
export function renderChapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    title: row.title === "" ? row.id : row.title,
    // The column is a CHECK constraint over the shared list (ADR #25), so the
    // stored text is one of its values — the narrowing the row type cannot
    // express.
    ...(row.status === null ? {} : { status: row.status as ChapterStatus }),
    body: row.body,
    rev: row.rev,
  };
}

// --- reading ------------------------------------------------------------------

/** One chapter, inside a handle; 404 when the campaign has none with that id. */
export function chapterIn(tx: GrimoireDb, campaign: string, id: string): Chapter {
  const row = chapterRowOf(tx, campaign, id);
  if (row === undefined) throw new ApiError(404, "chapter not found");
  return renderChapter(row);
}

/** GET /api/campaigns/:campaign/chapters/:id */
export async function readChapter(campaign: string, id: string): Promise<Chapter> {
  await requireCampaign(campaign);
  return chapterIn(await getDb(), campaign, id);
}

/**
 * GET /api/campaigns/:campaign/chapters — every chapter of the campaign in
 * the campaign's order (`pos`, the id as the tie-break).
 */
export async function listChapters(campaign: string): Promise<Chapter[]> {
  await requireCampaign(campaign);
  const db = await getDb();
  return (
    db
      .select()
      .from(chapters)
      .where(eq(chapters.campaignId, campaign))
      .orderBy(asc(chapters.pos), asc(chapters.id))
      .all() as ChapterRow[]
  ).map(renderChapter);
}

// --- writing ------------------------------------------------------------------

/**
 * The body of a chapter PATCH, checked against the chapter's schema: the
 * guard, `force` and any subset of the fields, `body` among them — a key that
 * is none of these, or a value of the wrong shape, is a 400 that names it. A
 * `status` outside the three comes first, with the code the app has a
 * sentence for (`status_not_allowed`, ADR #25).
 */
export function readChapterPatch(raw: unknown): ChapterPatch {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    assertChapterStatus(raw as Record<string, unknown>);
  }
  return parseRequest(chapterPatchSchema, raw, "chapter patch");
}

/**
 * PATCH /api/campaigns/:campaign/chapters/:id — THE write of one chapter
 * (ADR #23): any subset of its fields in one row update against one `rev`.
 */
export async function patchChapter(campaign: string, id: string, raw: unknown): Promise<Chapter> {
  const patch = readChapterPatch(raw);
  return mutate(campaign, (tx) => patchChapterIn(tx, campaign, id, patch));
}

/**
 * The write itself, INSIDE the caller's transaction.
 *
 * Only the fields the patch names are touched; `null` clears the status.
 * `force` replaces the guard by the row's current rev — the DM's answer to
 * the conflict dialog, which writes only what this request carries. The id
 * never changes (ADR #21): a patch may echo it, never alter it. A patch that
 * names no field is a 400 `nothing_to_write`.
 *
 * A patch that makes the chapter `active` takes `active` off the chapter that
 * held it, in this transaction (`clearOtherActiveChapters`). Neither the
 * scene order's guard nor the thread list's moves: both are the chapter's
 * lists, not its fields (ADR #27, ADR #29).
 */
export function patchChapterIn(
  tx: GrimoireDb,
  campaign: string,
  id: string,
  patch: ChapterPatch,
): Chapter {
  const { rev, force, id: patchedId, ...fields } = patch;
  const named = Object.values(fields).some((value) => value !== undefined);
  if (!named && patchedId === undefined) {
    throw new ApiError(400, "nothing to write — send at least one field", {
      code: "nothing_to_write",
    });
  }
  const row = chapterRowOf(tx, campaign, id);
  if (row === undefined) throw new ApiError(404, "chapter not found");
  const guard = force === true ? row.rev : rev;
  if (row.rev !== guard) {
    throw revConflict(row.rev, "chapter changed", { chapter: renderChapter(row) });
  }
  if (patchedId !== undefined && patchedId !== row.id) {
    throw new ApiError(400, "id is the primary key — it is set at creation and never changes");
  }
  const next: ChapterRow = {
    ...row,
    title: fields.title ?? row.title,
    status: fields.status === undefined ? row.status : fields.status,
    body: fields.body === undefined ? row.body : normalizeBody(fields.body),
    rev: row.rev + 1,
  };
  if (next.status === CHAPTER_ACTIVE) clearOtherActiveChapters(tx, campaign, row.id);
  tx.update(chapters)
    .set({ title: next.title, status: next.status, body: next.body, rev: next.rev })
    .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, row.id)))
    .run();
  indexChapter(tx, campaign, next);
  return renderChapter(next);
}

// --- taking over a proposal ---------------------------------------------------

/**
 * A chapter without its guard — a fixture or the chapter a „Neues Kapitel"
 * run creates — checked against the chapter's schema. A key a chapter does
 * not have, or a value of the wrong shape, is refused with the message `what`
 * introduces.
 */
export function readChapterProposal(raw: unknown, what: string): ChapterProposal {
  return parseRequest(chapterProposalSchema, raw, what);
}

/** True when a proposal would land on a chapter that already exists. */
export function chapterTaken(tx: GrimoireDb, campaign: string, id: string): boolean {
  return chapterRowOf(tx, campaign, id) !== undefined;
}

/** The `pos` a chapter appended to the campaign gets: one past the last. */
function nextChapterPos(tx: GrimoireDb, campaign: string): number {
  return nextPos(
    tx.select({ pos: chapters.pos }).from(chapters).where(eq(chapters.campaignId, campaign)).all(),
  );
}

/**
 * Write one chapter proposal into the campaign, at its end, INSIDE the
 * caller's transaction — the seed and the generator's accept both end here.
 * The caller has checked for conflicts. An `active` proposal takes `active`
 * off the chapter that held it.
 */
export function insertChapterProposal(
  tx: GrimoireDb,
  campaign: string,
  proposal: ChapterProposal,
): void {
  if (proposal.status === CHAPTER_ACTIVE) clearOtherActiveChapters(tx, campaign, proposal.id);
  tx.insert(chapters)
    .values({
      campaignId: campaign,
      id: proposal.id,
      title: proposal.title,
      status: proposal.status ?? null,
      body: proposal.body,
      pos: nextChapterPos(tx, campaign),
    })
    .run();
  const row = chapterRowOf(tx, campaign, proposal.id);
  if (row !== undefined) indexChapter(tx, campaign, row);
}

// --- GET /api/campaigns/:campaign/tree ----------------------------------------

/** Lexicographic (code-unit) compare — locale-independent, stable. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * One scene as the tree lists it. `locationNames` resolves the scene's
 * location to the NAME the DM reads — the caller holds that map because it
 * builds a whole campaign's worth of summaries from one query of the
 * location rows.
 */
export function sceneSummaryRow(
  db: GrimoireDb,
  row: SceneRow,
  locationNames: ReadonlyMap<string, string>,
): SceneSummary {
  const summary: SceneSummary = {
    id: row.id,
    title: row.title === "" ? row.id : row.title,
    // Both columns are CHECK constraints over the shared lists (ADR #25), so
    // the stored text is one of their values — the narrowing the row type
    // cannot express.
    type: row.type as SceneType,
    status: row.status as SceneStatus,
    npcs: refNpcs(db, row.campaignId, row.id),
    tags: refTags(db, row.campaignId, row.id),
  };
  if (row.trigger !== null) summary.trigger = row.trigger;
  if (row.location !== null) {
    summary.location = row.location;
    // A referenced entry always exists (schema.ts rule 3), and an unnamed
    // one degrades to its id — still the word the DM typed.
    summary.locationName = locationNames.get(row.location) ?? row.location;
  }
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

  // Location id -> display name: a scene's summary names its location the
  // way the DM reads it, and one query answers that for the whole campaign.
  const locationRows = db
    .select()
    .from(locations)
    .where(eq(locations.campaignId, campaign))
    .all() as LocationRow[];
  const locationNames = new Map(
    locationRows.map((row) => [row.id, row.name === "" ? row.id : row.name] as const),
  );

  const chapterNodes: ChapterNode[] = chapterRows.map((chapter) => {
    // `sceneRows` is already in `pos`, `id` order and a filter keeps it, so
    // the chapter's scenes come out in the order the DM arranged them.
    const own = sceneRows.filter((s) => (s.chapterId ?? "") === chapter.id);
    const node: ChapterNode = {
      id: chapter.id,
      title: chapter.title === "" ? chapter.id : chapter.title,
      scenes: own.map((scene) => sceneSummaryRow(db, scene, locationNames)),
      // The order's guard token rides along so the overview can reorder
      // straight from the tree it already has, without reading the chapter
      // first for a token that is not even on it.
      sceneOrderRev: chapter.sceneOrderRev,
    };
    if (chapter.status !== null) node.status = chapter.status as ChapterStatus;
    return node;
  });

  const npcList: NpcSummary[] = (
    db.select().from(npcs).where(eq(npcs.campaignId, campaign)).all() as NpcRow[]
  )
    .map((row) => {
      // No address: an npc is its own resource (ADR #31).
      const summary: NpcSummary = {
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
      // No address: a location is its own resource (ADR #31).
      const summary: LocationSummary = {
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

// --- creating a chapter -------------------------------------------------------

/** True when the campaign has a chapter with this id (generator target check). */
export async function chapterExists(campaign: string, chapter: string): Promise<boolean> {
  const db = await getDb();
  return chapterRowOf(db, campaign, chapter) !== undefined;
}

/**
 * The text a new chapter starts with: the body it was given, verbatim,
 * trimmed and ending in one newline — no heading around it, because nothing
 * reads a chapter's text by its headings (ADR #29). Blank or absent is the
 * empty text.
 *
 * Both ways a chapter comes into being with a text use it: the create dialog
 * and a „Neues Kapitel" generator run (generator.ts `newChapterTarget`).
 */
export function newChapterBody(body?: string): string {
  const trimmed = body?.trim() ?? "";
  return trimmed === "" ? "" : `${trimmed}\n`;
}

/**
 * The body of a chapter POST, checked against the chapter's create form — a
 * key that is none of its fields, or a value of the wrong shape, is a 400
 * that names it. A `status` outside the three comes first, with the code the
 * app has a sentence for (`status_not_allowed`, ADR #25).
 */
export function readChapterCreate(raw: unknown): ChapterCreate {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    assertChapterStatus(raw as Record<string, unknown>);
  }
  return parseRequest(chapterCreateSchema, raw, "chapter");
}

/**
 * POST /api/campaigns/:campaign/chapters { title, id?, status?, body? } ->
 * the chapter. The three rules every create endpoint follows are in
 * store/shared.ts.
 *
 * `title` arrives trimmed and non-empty, `id` trimmed or absent. The chapter
 * starts at `status`, `planned` when the request names none; `active` makes
 * it THE active chapter and takes `active` off the one that held it, in the
 * same transaction. `body` becomes the chapter's text as it was typed
 * (`newChapterBody`); the chapter overview shows that text under the title.
 * The chapter goes to the end of the campaign.
 */
export async function createChapter(
  campaign: string,
  request: ChapterCreate,
): Promise<Chapter> {
  const id = resolveNewId(request.id, request.title, "chapter", "title");
  assertSafeChapterId(id);
  return mutate(campaign, (tx) => {
    if (chapterRowOf(tx, campaign, id) !== undefined) {
      const suggestion = freeSlug(id, (candidate) => chapterRowOf(tx, campaign, candidate) !== undefined);
      throw slugTaken("chapter", id, suggestion);
    }
    insertChapterProposal(tx, campaign, {
      id,
      title: request.title,
      // A chapter is born `planned` unless the DM says otherwise: the status
      // has three positions, and every chapter should start at one the DM can
      // read instead of at none at all.
      status: request.status ?? CHAPTER_PLANNED,
      body: newChapterBody(request.body),
    });
    return chapterIn(tx, campaign, id);
  });
}

/**
 * The chapter of a GENERATED scene, created if it has none of its own.
 *
 * The ONE write that brings a chapter into existence without the DM naming
 * it in a dialog, and it is not a mention creating anything: the run itself
 * decided the chapter (and, for a new-chapter run, its title), so
 * accepting the proposal has to be able to write it. Without this a scene
 * would name a chapter that has no row — and the overview lists chapters,
 * so the chapter and every scene in it would be unreachable.
 *
 * Idempotent and quiet: false when the chapter is already there, and false
 * for an id that is no entity slug — `assertChapterRef` then answers for it.
 * `planned`: a chapter the run brought is upcoming, never the active one.
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
      pos: nextChapterPos(tx, campaign),
    })
    .run();
  const row = chapterRowOf(tx, campaign, id);
  if (row !== undefined) indexChapter(tx, campaign, row);
  return true;
}
