// Taking over the generator's drafts.
//
// A draft is a pair of `properties` and `body` with a target address, and
// this is the write behind `POST /generate/apply`: one transaction for the
// whole batch, the documented `409 { conflicts }` decided INSIDE it, and the
// job row discarded in the same commit. A partial accept records what it
// wrote instead. Nothing here is a second write path for an entry — an entry
// that already holds content is a conflict, not something to overwrite.

import { and, desc, eq } from "drizzle-orm";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { chapters, generateJobs, locations, npcs, packJson, scenes } from "../db/schema";
import { campaignRow, mutate } from "./campaigns";
import { ensureChapterRow, nextScenePos, replaceSceneRefs, sceneLocation } from "./chapters";
import {
  assertChapterRef,
  assertLocationRef,
  assertNpcRefs,
  chapterRowOf,
  indexChapter,
  indexLocation,
  indexNpc,
  indexScene,
  locationRowOf,
  npcRowOf,
  sceneRowOf,
} from "./entity-rows";
import { getDb } from "./handle";
import { isEmptyLocationRow } from "./locations";
import { isEmptyNpcRow, NPC_DEFAULT_STATUS } from "./npcs";
import { addressIdentity, locatorFromPath, type Locator } from "./paths";
import { asMap, asOptStr, asStr, asStrArray, assertNpcStatus, assertSceneClosedFields } from "./shared";

// --- the generator's apply step ------------------------------------------------

export interface EntityDraft {
  /** Campaign-relative target path (the generator's own addressing). */
  rel: string;
  /**
   * The ADDRESS the row will actually have — `rel` with the id segment taken
   * from the properties (generator.ts `draftAddress`). The conflict check
   * asks about this, `rel` is only what a 409 reports back to the client.
   */
  address: string;
  properties: Record<string, unknown>;
  body: string;
}

/**
 * Where a scene draft goes in its chapter: a `pos`, or undefined for the end
 * of the chapter. Asked INSIDE the write transaction, once the scene's
 * chapter exists and before the scene is inserted — a generator run's start
 * is the chapter's end at that moment (store/chapters.ts `sceneRunPos`).
 */
export type ScenePlacement = (tx: GrimoireDb, rel: string, chapter: string) => number | undefined;

/**
 * Insert one generated entity (scene, npc, location stub or a new chapter's
 * metadata) — the database half of `POST /generate/apply`. The caller has
 * already validated everything and checked for conflicts; this is the write.
 */
export function insertDraft(
  tx: GrimoireDb,
  campaign: string,
  draft: EntityDraft,
  placeScene?: ScenePlacement,
): void {
  const locator = locatorFromPath(draft.rel);
  const props = draft.properties;
  switch (locator.kind) {
    case "scene": {
      const id = asStr(props.id, locator.id);
      const title = asStr(props.title, id);
      const npcRefs = asStrArray(props.npcs);
      const tags = asStrArray(props.tags);
      const draftLocation = sceneLocation(props.location);
      assertSceneClosedFields(props);
      // The scene's chapter is written in THIS transaction, before the scene
      // itself: a new-chapter run creates its chapter from the run's own
      // state (generator.ts `jobChapterTarget`), and this is the net under
      // it. Everything else the scene references has to be there already —
      // the drafts are sorted so the entries a scene names go in first
      // (`inReferenceOrder`), and a proposal that names one the batch does
      // not bring along is refused instead of leaving a hole behind.
      if (locator.chapterId !== null) ensureChapterRow(tx, campaign, locator.chapterId);
      assertChapterRef(tx, campaign, locator.chapterId);
      assertLocationRef(tx, campaign, draftLocation);
      assertNpcRefs(tx, campaign, npcRefs);
      // The end of ITS chapter, like every other way a scene is created: a
      // draft the DM accepts is new material, and new material goes last.
      // The one exception is a scene of a pipelined run, which the caller
      // places at its outline number from the run's start (ADR #27).
      const pos =
        placeScene?.(tx, draft.rel, locator.chapterId) ??
        nextScenePos(tx, campaign, locator.chapterId);
      tx.insert(scenes)
        .values({
          campaignId: campaign,
          id,
          chapterId: locator.chapterId,
          title,
          type: asStr(props.type, "planned"),
          trigger: asOptStr(props.trigger),
          location: draftLocation,
          status: asStr(props.status, "draft"),
          handouts: packJson(asStrArray(props.handouts)),
          body: draft.body,
          pos,
        })
        .run();
      replaceSceneRefs(tx, campaign, id, npcRefs, tags);
      const row = sceneRowOf(tx, campaign, id);
      if (row !== undefined) indexScene(tx, campaign, row, tags);
      return;
    }
    case "npc": {
      const id = asStr(props.id, locator.id);
      const npcChapter = asOptStr(props.chapter);
      assertChapterRef(tx, campaign, npcChapter);
      assertNpcStatus(props);
      const values = {
        name: asStr(props.name, id),
        role: asOptStr(props.role),
        chapterId: npcChapter,
        status: asStr(props.status, NPC_DEFAULT_STATUS),
        statblock: asOptStr(props.statblock),
        quickstats: packJson(asMap(props.quickstats)),
        voice: asOptStr(props.voice),
        appearance: asOptStr(props.appearance),
        motivation: asOptStr(props.motivation),
        body: draft.body,
      };
      // An entry the DM created and left empty is FILLED — inserting would
      // collide with a row that holds nothing to lose.
      const existing = npcRowOf(tx, campaign, id);
      if (existing !== undefined) {
        tx.update(npcs)
          .set({ ...values, rev: existing.rev + 1 })
          .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, id)))
          .run();
      } else {
        tx.insert(npcs)
          .values({ campaignId: campaign, id, ...values })
          .run();
      }
      const row = npcRowOf(tx, campaign, id);
      if (row !== undefined) indexNpc(tx, campaign, row);
      return;
    }
    case "location": {
      const id = asStr(props.id, locator.id);
      const locationChapter = asOptStr(props.chapter);
      assertChapterRef(tx, campaign, locationChapter);
      const values = {
        name: asStr(props.name, id),
        chapterId: locationChapter,
        roll20Page: asOptStr(props["roll20-page"]),
        atmosphere: asOptStr(props.atmosphere),
        body: draft.body,
      };
      // Fill an empty entry rather than collide with it — see the npc case.
      const existing = locationRowOf(tx, campaign, id);
      if (existing !== undefined) {
        tx.update(locations)
          .set({ ...values, rev: existing.rev + 1 })
          .where(and(eq(locations.campaignId, campaign), eq(locations.id, id)))
          .run();
      } else {
        tx.insert(locations)
          .values({ campaignId: campaign, id, ...values })
          .run();
      }
      const row = locationRowOf(tx, campaign, id);
      if (row !== undefined) indexLocation(tx, campaign, row);
      return;
    }
    case "chapter": {
      const pos =
        (tx
          .select({ pos: chapters.pos })
          .from(chapters)
          .where(eq(chapters.campaignId, campaign))
          .orderBy(desc(chapters.pos))
          .limit(1)
          .all()[0]?.pos ?? -1) + 1;
      tx.insert(chapters)
        .values({
          campaignId: campaign,
          id: locator.id,
          title: asStr(props.title, locator.id),
          status: asOptStr(props.status),
          body: draft.body,
          pos,
        })
        .run();
      const row = chapterRowOf(tx, campaign, locator.id);
      if (row !== undefined) indexChapter(tx, campaign, row);
      return;
    }
    default:
      throw new ApiError(400, `cannot write ${draft.rel}`);
  }
}

/**
 * Run a batch of generator writes in ONE transaction — and CHECK THE
 * CONFLICTS IN IT. A check in front of the transaction (generator.ts) would
 * leave a window between "nothing exists yet" and the
 * insert: a scene created in between would turn the documented
 * `409 { conflicts }` into a primary-key violation, i.e. a 500. Inside the
 * transaction there is no window, and a constraint that fires anyway is
 * translated back to the documented answer instead of escaping as a 500 —
 * either way the transaction rolls back, so a partial apply is impossible.
 *
 * `jobId` discards the generate job the drafts came from IN THE
 * SAME COMMIT, never as a second statement after the write: a crash in
 * between would leave a `done` job whose drafts were already stored, so the
 * next start would offer a review that could only ever answer 409 — and a
 * failing delete would turn a successful write into a 500. The job row
 * disappears exactly when the drafts appear, or neither does. A stale id (a
 * newer run started meanwhile) matches nothing and is ignored, which is the
 * documented behaviour.
 */
export async function applyDrafts(
  campaign: string,
  drafts: EntityDraft[],
  options: {
    jobId?: string;
    /**
     * A PARTIAL accept does not discard the job — it records what
     * it wrote on it and deletes the row only when nothing is left open. That
     * bookkeeping belongs in THIS transaction for the same reason the discard
     * does: after a crash the job and the entries it produced must not
     * disagree. When it is given it replaces the `jobId` discard entirely.
     */
    onWritten?: (tx: GrimoireDb) => void;
    /** Where the scene drafts go; absent, every one goes to its chapter's end. */
    placeScene?: ScenePlacement;
  } = {},
): Promise<void> {
  const { jobId, onWritten, placeScene } = options;
  try {
    await mutate(campaign, (tx) => {
      // TWO drafts for ONE address are a conflict too. An empty entry is no
      // conflict, so the second draft does not hit the primary key: unchecked
      // it would FILL the entry the first had just written, last write wins,
      // and the review would report a clean apply for content it had silently
      // dropped. The batch is the model's output — one hallucinated duplicate
      // id is exactly the case — so the answer is the documented one, and it
      // names both offenders.
      const duplicates = duplicateDraftRels(drafts);
      if (duplicates.length > 0) {
        throw new ApiError(409, "two drafts for the same target", { conflicts: duplicates });
      }
      const conflicts = drafts
        .filter((draft) => draftTargetExistsIn(tx, campaign, draft.address))
        .map((draft) => draft.rel);
      if (conflicts.length > 0) {
        throw new ApiError(409, "target entries already exist", { conflicts });
      }
      for (const draft of inReferenceOrder(drafts)) insertDraft(tx, campaign, draft, placeScene);
      if (onWritten !== undefined) {
        onWritten(tx);
      } else if (jobId !== undefined) {
        tx.delete(generateJobs)
          .where(and(eq(generateJobs.id, jobId), eq(generateJobs.campaignId, campaign)))
          .run();
      }
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isConstraintViolation(error)) {
      throw new ApiError(409, "target entries already exist", {
        conflicts: drafts.map((draft) => draft.rel),
      });
    }
    throw error;
  }
}

/**
 * How the kinds of a batch are inserted: a chapter before the entries that
 * name it, an npc and a location before the scene that lists them. The
 * constraints are checked per statement, so a batch that brings the stub
 * along has to write the stub first — and the caller's order is the review's,
 * which is about reading, not about references. Nothing else about the apply
 * depends on it: the conflict check is one pass over the whole batch before
 * any insert, and what a partial accept records is keyed by address.
 */
const REFERENCE_ORDER: Record<string, number> = {
  campaign: 0,
  chapter: 1,
  npc: 2,
  location: 2,
  scene: 3,
};

/** The batch in that order, stable within a kind. */
function inReferenceOrder(drafts: EntityDraft[]): EntityDraft[] {
  const rank = (draft: EntityDraft): number => {
    try {
      return REFERENCE_ORDER[locatorFromPath(draft.rel).kind] ?? 4;
    } catch {
      // An address nothing can parse: `insertDraft` answers for it, last.
      return 4;
    }
  };
  return drafts
    .map((draft, index) => ({ draft, index }))
    .sort((a, b) => rank(a.draft) - rank(b.draft) || a.index - b.index)
    .map((entry) => entry.draft);
}

/**
 * The `rel`s of every draft whose ROW another draft in the batch claims too
 * — `rel` because that is what the review shows.
 *
 * Keyed by IDENTITY (`addressIdentity`), not by address: a scene's address
 * carries its `location`, so two drafts with the same id and
 * different locations have different addresses and the same primary key.
 * Keying on the address let that pair through, and the insert then filled
 * the row twice — last write wins, and the review reported a clean apply for
 * content it had silently dropped.
 */
function duplicateDraftRels(drafts: EntityDraft[]): string[] {
  const seen = new Map<string, number>();
  for (const draft of drafts) {
    const key = addressIdentity(draft.address);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return drafts
    .filter((draft) => (seen.get(addressIdentity(draft.address)) ?? 0) > 1)
    .map((draft) => draft.rel)
    .sort();
}

/**
 * A UNIQUE/PRIMARY KEY violation from either SQLite backend (ADR #13) — the
 * race the conflict check above cannot close, and the only constraint failure
 * that means "the target is taken".
 *
 * NAMED CONSTRAINTS ONLY, deliberately. A plain /constraint/ also matches
 * "FOREIGN KEY constraint failed", so a draft that names an entry the batch
 * does not bring would turn into a 409 listing every draft as an existing
 * target — an answer about the wrong thing, and about entries that are not
 * there.
 * A reference that names nothing is a 400 with its own code, raised by the
 * assertions before the insert; anything else is not this function's answer
 * and travels on as the error it is.
 */
function isConstraintViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(UNIQUE|PRIMARY KEY) constraint failed/i.test(message);
}

/** True when a generated target already exists (the apply step's 409). */
export async function draftTargetExists(campaign: string, rel: string): Promise<boolean> {
  return draftTargetExistsIn(await getDb(), campaign, rel);
}

/** The same question inside a transaction — synchronous, so it can be. */
function draftTargetExistsIn(db: GrimoireDb, campaign: string, rel: string): boolean {
  let locator: Locator;
  try {
    locator = locatorFromPath(rel);
  } catch {
    return false;
  }
  switch (locator.kind) {
    case "scene":
      return sceneRowOf(db, campaign, locator.id) !== undefined;
    // An EMPTY npc/location entry is not a conflict: the DM created the id
    // and typed nothing, and the generated entity is exactly what fills it.
    // An entry with content still answers 409.
    case "npc": {
      const row = npcRowOf(db, campaign, locator.id);
      return row !== undefined && !isEmptyNpcRow(row);
    }
    case "location": {
      const row = locationRowOf(db, campaign, locator.id);
      return row !== undefined && !isEmptyLocationRow(row);
    }
    case "chapter":
      return chapterRowOf(db, campaign, locator.id) !== undefined;
    case "campaign":
      return (campaignRow(db, campaign)?.name ?? "") !== "";
    default:
      return false;
  }
}
