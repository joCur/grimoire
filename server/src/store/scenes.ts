// Scenes: the scene resource read, listed, written, created and taken over
// from a proposal — all of it typed by the scene's one zod schema (decisions/resources,
// @grimoire/shared/scene). A row and its reference rows render into a
// `Scene`, and a `ScenePatch` or a `SceneProposal` writes into them.
//
// A scene lies flat under its campaign: its id is unique per campaign, and
// its chapter is a field that may change but never be cleared. Where a scene
// stands in its chapter is the chapter's scene order (./chapters.ts), which
// has its own write and its own guard (decisions/scene-order): creating a scene appends it
// to its chapter, moving it to another chapter appends it there, and nothing
// else here touches `pos`.

import { and, asc, eq } from "drizzle-orm";
import {
  ENTITY_SLUG,
  freeSlug,
  scenePatchSchema,
  sceneProposalSchema,
  toSlug,
  type Scene,
  type ScenePatch,
  type SceneProposal,
  type SceneStatus,
  type SceneType,
} from "@grimoire/shared";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import {
  chapters,
  generateJobs,
  packJson,
  sceneNpcs,
  sceneTags,
  scenes,
  unpackStringArray,
} from "../db/schema";
import { mutate, requireCampaign } from "./campaigns";
import { assertChapterRef, nextScenePos } from "./chapters";
import { indexEntity } from "./fts";
import { assertLocationRef } from "./locations";
import { assertNpcRefs } from "./npcs";
import { getDb } from "./handle";
import { expandCampaignBodyRefs } from "./refs";
import type { SceneRow } from "./render";
import { reindexReferrers } from "./search-index";
import {
  assertSafeChapterId,
  assertSceneClosedFields,
  normalizeBody,
  parseRequest,
  resolveNewId,
  revConflict,
  slugTaken,
  unknownRef,
} from "./shared";

// --- rendering a row ----------------------------------------------------------

/**
 * The scene of a row and its reference rows. An empty title falls back to
 * the id — the same display-name rule as everywhere — and a column that
 * holds nothing is a field the scene does not carry. The body travels
 * exactly as it is stored: nothing about a scene is derived from its text
 * (decisions/data-shape).
 */
export function renderScene(row: SceneRow, npcs: string[], tags: string[]): Scene {
  return {
    id: row.id,
    title: row.title === "" ? row.id : row.title,
    // Both columns are CHECK constraints over the shared lists (decisions/constraints), so
    // the stored text is one of their values — the narrowing the row type
    // cannot express.
    type: row.type as SceneType,
    ...(row.trigger === null ? {} : { trigger: row.trigger }),
    chapter: row.chapterId,
    ...(row.location === null ? {} : { location: row.location }),
    npcs,
    handouts: unpackStringArray(row.handouts),
    tags,
    status: row.status as SceneStatus,
    body: row.body,
    rev: row.rev,
  };
}

/** A row rendered with the reference rows it has in `tx`. */
function renderRow(tx: GrimoireDb, campaign: string, row: SceneRow): Scene {
  return renderScene(row, refNpcs(tx, campaign, row.id), refTags(tx, campaign, row.id));
}

// --- reading ------------------------------------------------------------------

/** One scene, inside a handle; 404 when the campaign has none with that id. */
export function sceneIn(tx: GrimoireDb, campaign: string, id: string): Scene {
  const row = sceneRowOf(tx, campaign, id);
  if (row === undefined) throw new ApiError(404, "scene not found");
  return renderRow(tx, campaign, row);
}

/** GET /api/campaigns/:campaign/scenes/:id */
export async function readScene(campaign: string, id: string): Promise<Scene> {
  await requireCampaign(campaign);
  return sceneIn(await getDb(), campaign, id);
}

/**
 * GET /api/campaigns/:campaign/scenes — every scene of the campaign, chapter
 * by chapter in the chapters' order, and inside a chapter in the order the DM
 * set (`pos`, the id as the tie-break).
 */
export async function listScenes(campaign: string): Promise<Scene[]> {
  await requireCampaign(campaign);
  const db = await getDb();
  const rows = db
    .select({ scene: scenes })
    .from(scenes)
    .innerJoin(
      chapters,
      and(eq(chapters.campaignId, scenes.campaignId), eq(chapters.id, scenes.chapterId)),
    )
    .where(eq(scenes.campaignId, campaign))
    .orderBy(asc(chapters.pos), asc(chapters.id), asc(scenes.pos), asc(scenes.id))
    .all()
    .map((joined) => joined.scene as SceneRow);
  return rows.map((row) => renderRow(db, campaign, row));
}

// --- a scene's location and reference rows ------------------------------------

/**
 * A scene's `location`, validated: a location id, or null.
 *
 * `location` is a REFERENCE, so free text is a 400 that carries the slug it
 * would have been, and the app can say which id to use; whether that id has a
 * location is the next question (`assertLocationRef`).
 */
export function sceneLocation(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
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
function replaceSceneRefs(
  tx: GrimoireDb,
  campaign: string,
  sceneId: string,
  npcRefs: readonly string[],
  tags: readonly string[],
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

// --- writing ------------------------------------------------------------------

/**
 * The body of a scene PATCH, checked against the scene's schema: the guard,
 * `force` and any subset of the fields, `body` among them — a key that is
 * none of these, or a value of the wrong shape, is a 400 that names it. Three
 * refusals come first, each with the code the app has a sentence for: a
 * `status` outside the four (`status_not_allowed`), a `type` outside the two
 * (`scene_type_not_allowed`, decisions/constraints), and a cleared `chapter`
 * (`chapter_required`).
 */
export function readScenePatch(raw: unknown): ScenePatch {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const fields = raw as Record<string, unknown>;
    assertSceneClosedFields(fields);
    if (fields.chapter === null) {
      throw new ApiError(400, "chapter cannot be removed — a scene belongs to a chapter", {
        code: "chapter_required",
      });
    }
  }
  return parseRequest(scenePatchSchema, raw, "scene patch");
}

/**
 * PATCH /api/campaigns/:campaign/scenes/:id — THE write of one scene
 * (decisions/writes): any subset of its fields in one row update against one `rev`.
 *
 * `jobId` discards the generator job the write came from — an accepted
 * augment proposal — in the SAME transaction. A stale id matches nothing and
 * is ignored.
 */
export async function patchScene(
  campaign: string,
  id: string,
  raw: unknown,
  jobId?: string,
): Promise<Scene> {
  const patch = readScenePatch(raw);
  return mutate(campaign, (tx) => {
    const written = patchSceneIn(tx, campaign, id, patch);
    if (jobId !== undefined) {
      tx.delete(generateJobs)
        .where(and(eq(generateJobs.id, jobId), eq(generateJobs.campaignId, campaign)))
        .run();
    }
    return written;
  });
}

/**
 * The write itself, INSIDE the caller's transaction.
 *
 * Only the fields the patch names are touched; `null` clears an optional
 * one. `force` replaces the guard by the row's current rev — the DM's answer
 * to the conflict dialog, which writes only what this request carries. Every
 * reference has to name something that exists (400 otherwise), checked
 * before anything is written, and the id never changes (decisions/constraints): a patch may
 * echo it, never alter it. A patch that names no field is a 400
 * `nothing_to_write`.
 *
 * A scene that CHANGES chapter lands at the end of the new one: its old
 * position counted among other siblings and means nothing there, and the
 * target chapter's order is the DM's — a scene arriving in the middle of it
 * would move without anybody saying where. Staying in the chapter leaves
 * `pos` untouched, so an ordinary save reshuffles nothing, and neither moves
 * the chapter's order guard (decisions/scene-order).
 */
export function patchSceneIn(
  tx: GrimoireDb,
  campaign: string,
  id: string,
  patch: ScenePatch,
): Scene {
  const { rev, force, id: patchedId, ...fields } = patch;
  const named = Object.values(fields).some((value) => value !== undefined);
  if (!named && patchedId === undefined) {
    throw new ApiError(400, "nothing to write — send at least one field", {
      code: "nothing_to_write",
    });
  }
  const row = sceneRowOf(tx, campaign, id);
  if (row === undefined) throw new ApiError(404, "scene not found");
  const guard = force === true ? row.rev : rev;
  if (row.rev !== guard) {
    throw revConflict(row.rev, "scene changed", { scene: renderRow(tx, campaign, row) });
  }
  if (patchedId !== undefined && patchedId !== row.id) {
    throw new ApiError(400, "id is the primary key — it is set at creation and never changes");
  }
  const chapter = fields.chapter ?? row.chapterId;
  const location = fields.location === undefined ? row.location : sceneLocation(fields.location);
  const npcRefs = fields.npcs ?? refNpcs(tx, campaign, row.id);
  const tags = fields.tags ?? refTags(tx, campaign, row.id);
  assertChapterRef(tx, campaign, chapter);
  assertLocationRef(tx, campaign, location);
  assertNpcRefs(tx, campaign, npcRefs);
  const next: SceneRow = {
    ...row,
    title: fields.title ?? row.title,
    type: fields.type ?? row.type,
    trigger: fields.trigger === undefined ? row.trigger : fields.trigger,
    chapterId: chapter,
    location,
    status: fields.status ?? row.status,
    handouts: fields.handouts === undefined ? row.handouts : packJson(fields.handouts),
    body: fields.body === undefined ? row.body : normalizeBody(fields.body),
    pos: chapter === row.chapterId ? row.pos : nextScenePos(tx, campaign, chapter),
    rev: row.rev + 1,
  };
  tx.update(scenes)
    .set({
      title: next.title,
      type: next.type,
      trigger: next.trigger,
      chapterId: next.chapterId,
      location: next.location,
      status: next.status,
      handouts: next.handouts,
      body: next.body,
      pos: next.pos,
      rev: next.rev,
    })
    .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, row.id)))
    .run();
  if (fields.npcs !== undefined || fields.tags !== undefined) {
    replaceSceneRefs(tx, campaign, row.id, npcRefs, tags);
  }
  indexScene(tx, campaign, next, tags);
  return renderRow(tx, campaign, next);
}

// --- taking over a proposal ---------------------------------------------------

/**
 * A scene without its guard — a fixture or a generator proposal — checked
 * against the scene's schema. A key a scene does not have, or a value of the
 * wrong shape, is refused with the message `what` introduces.
 */
export function readSceneProposal(raw: unknown, what: string): SceneProposal {
  return parseRequest(sceneProposalSchema, raw, what);
}

/** True when a proposal would land on a scene that already exists. */
export function sceneTaken(tx: GrimoireDb, campaign: string, id: string): boolean {
  return sceneRowOf(tx, campaign, id) !== undefined;
}

/**
 * Write one scene proposal into the campaign, INSIDE the caller's
 * transaction — the seed and the generator's accept both end here. The
 * caller has checked for conflicts. Every reference has to name something
 * that exists; nothing is created because the proposal names it.
 *
 * `pos` is where the scene goes in its chapter; absent, it goes to the end,
 * like every other new scene.
 */
export function insertSceneProposal(
  tx: GrimoireDb,
  campaign: string,
  proposal: SceneProposal,
  pos?: number,
): void {
  const location = sceneLocation(proposal.location);
  assertChapterRef(tx, campaign, proposal.chapter);
  assertLocationRef(tx, campaign, location);
  assertNpcRefs(tx, campaign, proposal.npcs);
  tx.insert(scenes)
    .values({
      campaignId: campaign,
      id: proposal.id,
      chapterId: proposal.chapter,
      title: proposal.title,
      type: proposal.type,
      trigger: proposal.trigger ?? null,
      location,
      status: proposal.status,
      handouts: packJson(proposal.handouts),
      body: proposal.body,
      pos: pos ?? nextScenePos(tx, campaign, proposal.chapter),
    })
    .run();
  replaceSceneRefs(tx, campaign, proposal.id, proposal.npcs, proposal.tags);
  const row = sceneRowOf(tx, campaign, proposal.id);
  if (row !== undefined) indexScene(tx, campaign, row, refTags(tx, campaign, row.id));
}

// --- creating a scene ---------------------------------------------------------

/**
 * POST /api/campaigns/:campaign/scenes { title, chapter, id? } -> the scene.
 * The three rules every create endpoint follows are in store/shared.ts.
 *
 * The chapter is REQUIRED and has to exist (400 otherwise): a scene belongs
 * to a chapter, and a mention creates nothing (decisions/constraints). The scene holds its
 * title and nothing else, and it is appended to the END of its chapter
 * (`nextScenePos`): a new scene has no place of its own yet, and the DM moves
 * it where it belongs.
 */
export async function createScene(
  campaign: string,
  title: string,
  chapter: string,
  explicitId?: string,
): Promise<Scene> {
  const id = resolveNewId(explicitId, title, "scene", "title");
  assertSafeChapterId(chapter);
  return mutate(campaign, (tx) => {
    assertChapterRef(tx, campaign, chapter);
    if (sceneRowOf(tx, campaign, id) !== undefined) {
      const suggestion = freeSlug(id, (candidate) => sceneRowOf(tx, campaign, candidate) !== undefined);
      throw slugTaken("scene", id, suggestion);
    }
    tx.insert(scenes)
      .values({
        campaignId: campaign,
        id,
        chapterId: chapter,
        title: title.trim(),
        pos: nextScenePos(tx, campaign, chapter),
      })
      .run();
    const row = sceneRowOf(tx, campaign, id);
    if (row === undefined) throw new ApiError(500, "scene could not be created");
    indexScene(tx, campaign, row, []);
    return renderScene(row, [], []);
  });
}

// --- loading and checking a scene row ------------------------------------------

/** One scene row by id, read through `tx` (the database or a transaction). */
export function sceneRowOf(tx: GrimoireDb, campaign: string, id: string): SceneRow | undefined {
  return tx
    .select()
    .from(scenes)
    .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, id)))
    .all()[0] as SceneRow | undefined;
}

/** The npc ids of a scene, in the order the DM gave them. */
export function refNpcs(tx: GrimoireDb, campaign: string, sceneId: string): string[] {
  return tx
    .select({ npcId: sceneNpcs.npcId })
    .from(sceneNpcs)
    .where(and(eq(sceneNpcs.campaignId, campaign), eq(sceneNpcs.sceneId, sceneId)))
    .orderBy(asc(sceneNpcs.pos))
    .all()
    .map((r) => r.npcId);
}

/** The tags of a scene, in the order the DM gave them. */
export function refTags(tx: GrimoireDb, campaign: string, sceneId: string): string[] {
  return tx
    .select({ tag: sceneTags.tag })
    .from(sceneTags)
    .where(and(eq(sceneTags.campaignId, campaign), eq(sceneTags.sceneId, sceneId)))
    .orderBy(asc(sceneTags.pos))
    .all()
    .map((r) => r.tag);
}

/**
 * The scene a session's log entry or played scene names — `code` says which
 * of the two it is (`log_scene_unknown`, `played_scene_unknown`).
 */
export function assertSceneRef(
  tx: GrimoireDb,
  campaign: string,
  id: string,
  code: "log_scene_unknown" | "played_scene_unknown",
): void {
  if (sceneRowOf(tx, campaign, id) !== undefined) return;
  throw unknownRef(code, "scene", id);
}

/** Rebuild a scene's search-index row, then the rows of what references it. */
export function indexScene(tx: GrimoireDb, campaign: string, row: SceneRow, tags: string[]): void {
  indexEntity(tx, campaign, {
    kind: "scene",
    entityId: row.id,
    title: row.title === "" ? row.id : row.title,
    ref: row.id,
    tags: tags.join(" "),
    body: expandCampaignBodyRefs(tx, campaign, row.body),
  });
  reindexReferrers(tx, campaign, row.id);
}
