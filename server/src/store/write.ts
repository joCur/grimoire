// The write side of the store: every write endpoint as database statements.
//
// One entry has ONE write, `patchEntry` — fields, text, or both (ADR #23).
//
// The contract the tests pin:
//
//   * the response of every write is the `EntryResponse` of the row it
//     touched, rendered by ./render;
//   * optimistic concurrency answers `409 { error, code: "rev_conflict",
//     rev, entry }`, with the row's `rev` as the token and the entry as it
//     stands. That is what closes the same-second race: two writes against
//     the same `rev` cannot both go through. `force` is the documented way
//     past it and writes only the fields the request carries;
//   * the session state machine has its answers and codes
//     (`session_running`, `session_not_empty`), and the local-time formats
//     are the three constants below — session ids, `started`/`ended` and
//     log times are zone-less local strings produced by the server;
//   * append-only stays append-only: log lines and inbox entries grow by
//     rows through their own endpoints, and the one documented exception
//     (an inbox entry marked done) is the `done` flag.
//
// A write is one TRANSACTION that also bumps `campaigns.version` — the
// counter `GET /version` answers, which is how a client learns about a
// change (DECISIONS #9). Both the content change and the version bump commit
// together, so a client poll can never see a bumped version without the
// change.

import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  ENTITY_SLUG,
  freeSlug,
  toSlug,
  type EntryResponse,
  type PatchEntryRequest,
} from "@grimoire/shared";
import { ApiError } from "../api-error";
import { assertSafeAddress } from "../addressing";
import type { GrimoireDb } from "../db/client";
import { logLineShortHash } from "./body-parse";
import {
  campaigns,
  chapters,
  generateJobs,
  locations,
  npcs,
  packJson,
  sceneNpcs,
  sceneTags,
  scenes,
} from "../db/schema";
import { campaignRow, indexCampaign, mutate, requireCampaignRow } from "./campaigns";
import {
  CHAPTER_ACTIVE,
  clearOtherActiveChapters,
  ensureChapterRow,
  replaceSceneRefs,
  sceneLocation,
} from "./chapters";
import { isEmptyLocationRow } from "./locations";
import { isEmptyNpcRow, NPC_DEFAULT_STATUS } from "./npcs";
import {
  asMap,
  asOptStr,
  asStr,
  asStrArray,
  assertChapterStatus,
  assertNpcStatus,
  assertSafeChapterId,
  assertSceneClosedFields,
  guardRev,
  nextPos,
  resolveNewId,
  revConflict,
  slugReserved,
  slugTaken,
  unknownRef,
} from "./shared";
import {
  assertChapterRef,
  assertLocationRef,
  assertNpcRefs,
  chapterIdExists,
  chapterRowOf,
  indexChapter,
  indexLocation,
  indexNpc,
  indexScene,
  locationRowOf,
  npcRowOf,
  refNpcs,
  refTags,
  sceneRowAt,
  sceneRowOf,
} from "./entity-rows";
import { expandBodyRefs } from "./refs";
import { getDb } from "./handle";
import { readByLocator } from "./read";
import {
  addressIdentity,
  addressSegments,
  chapterPath,
  locationPath,
  locatorFromPath,
  npcPath,
  RESERVED_SEGMENTS,
  sceneAddress,
  scenePath,
  type Locator,
} from "./paths";
import {
  renderCampaign,
  renderChapter,
  renderInbox,
  renderLocation,
  renderNpc,
  renderScene,
  type CampaignRow,
  type ChapterRow,
  type LocationRow,
  type NpcRow,
  type SceneRow,
  type SessionRow,
} from "./render";

export { logLineShortHash };






/**
 * The guard of an ADDRESSED entry: same check, and the 409 carries the
 * entry. Rendering it is the read path's own function, so the conflict body
 * is byte-for-byte what a GET of that address answers.
 */
function guardEntryRev(
  tx: GrimoireDb,
  campaign: string,
  locator: Locator,
  current: number,
  sent: number,
  what: string,
): void {
  if (current === sent) return;
  throw revConflict(current, what, readByLocator(tx, requireCampaignRow(tx, campaign), locator));
}

/** Keys that would hit Object.prototype machinery instead of data. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);


/**
 * Apply a flat properties patch to a rendered properties mapping (`null`
 * deletes a key) — the same semantics the raw-text patcher had, minus the
 * YAML round trip: the columns are the values now.
 */
function applyPatch(
  props: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...props };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "" || UNSAFE_KEYS.has(key)) throw new ApiError(400, `invalid patch key: ${key}`);
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}











// --- PATCH /api/campaigns/:campaign/entries/<address> ---------------------------------

/**
 * THE CONTRACT KEYS per kind — the complete set of properties a stored entry
 * can carry, in the README's order. There is nothing beside them: a key that
 * is not on its kind's list has no field behind it, so a patch naming one is
 * a 400 and a seed naming one is refused.
 */
const SCENE_KEYS = [
  "id",
  "title",
  "type",
  "trigger",
  "chapter",
  "location",
  "npcs",
  "handouts",
  "tags",
  "status",
] as const;
const NPC_KEYS = [
  "id",
  "name",
  "role",
  "chapter",
  "status",
  "statblock",
  "quickstats",
  "voice",
  "appearance",
] as const;
const LOCATION_KEYS = ["id", "name", "chapter", "roll20-page"] as const;
const CHAPTER_KEYS = ["id", "title", "status"] as const;
const CAMPAIGN_KEYS = ["id", "name", "description"] as const;
/**
 * A session is not an entry and has no properties patch (ADR #26). The list
 * survives for the SEED, which writes historic sessions from this shape
 * (db/seed.ts) — `reviewed` is not among them, because the review flag sits
 * on the log row it belongs to.
 */
const SESSION_KEYS = ["id", "started", "ended", "scenes_played", "pauses"] as const;

/** The same lists by kind, for callers that look one up (db/seed.ts). */
export const PROPERTY_CONTRACT = {
  campaign: CAMPAIGN_KEYS,
  chapter: CHAPTER_KEYS,
  scene: SCENE_KEYS,
  npc: NPC_KEYS,
  location: LOCATION_KEYS,
  session: SESSION_KEYS,
} as const satisfies Record<string, readonly string[]>;

/**
/**
 * A patch may only name keys the CONTRACT names (schema.ts rule 1). There is
 * no field behind anything else, and a typo would otherwise become a silent
 * new key.
 */
function rejectUnknownKeys(patch: Record<string, unknown>, contract: readonly string[]): void {
  for (const key of Object.keys(patch)) {
    if (contract.includes(key)) continue;
    throw new ApiError(400, `unknown property "${key}" — the entry has no such field`);
  }
}

function rejectIdPatch(patch: Record<string, unknown>, current: string): void {
  if (!("id" in patch)) return;
  const next = patch.id;
  if (typeof next === "string" && next === current) return; // a no-op patch is fine
  throw new ApiError(400, "id is the primary key — it is set at creation and never changes");
}

/**
 * THE write of one entry (ADR #23): fields, text, or both, in ONE
 * transaction against ONE `rev`.
 *
 * Both halves go into ONE row update, so the write steps `rev` exactly once
 * however much it carries: `rev + 1` is not a client's business, but two
 * steps for one save would leak the two statements this used to be and make
 * the row's history claim a write that never happened. The answer carries
 * the new token, and a properties patch that MOVES the entry (a scene whose
 * `chapter` changes lands under another address) is already resolved in the
 * `path` that comes back. A refusal anywhere rolls the whole request back,
 * so nothing is half-written.
 *
 * `force` replaces the guard by the row's CURRENT rev, read inside this
 * transaction. It is the DM's answer to the conflict dialog and writes only
 * the fields of this request, so a status somebody else changed meanwhile
 * survives a forced text save.
 *
 * `jobId` discards the generator job the write came from, in the SAME
 * transaction (drafts and job can never disagree after a crash). A stale id
 * matches nothing and is ignored.
 */
export async function patchEntry(
  campaign: string,
  rel: string,
  request: PatchEntryRequest,
  jobId?: string,
): Promise<EntryResponse> {
  assertSafeAddress(rel);
  const locator = locatorFromPath(rel);
  const patch = request.properties;
  const markdown = request.body;
  // An EMPTY properties object counts as nothing either: it would pass the
  // guard and write no field, which looks like a save and is not one.
  const hasProperties = patch !== undefined && Object.keys(patch).length > 0;
  if (!hasProperties && markdown === undefined) {
    throw new ApiError(400, "nothing to write — send properties, body, or both", {
      code: "nothing_to_write",
    });
  }
  return mutate(campaign, (tx) => {
    const guard =
      request.force === true
        ? readByLocator(tx, requireCampaignRow(tx, campaign), locator).rev
        : request.rev;
    const body = markdown === undefined ? undefined : normalizeBody(markdown);
    // With fields in the request the body rides along in the SAME update; a
    // text-only save is the body write on its own. Either way: one update,
    // one rev step, one re-index.
    const written = hasProperties
      ? patchLocator(tx, campaign, locator, guard, patch as Record<string, unknown>, body)
      : writeBodyIn(tx, campaign, locator, guard, body as string);
    if (jobId !== undefined) {
      tx.delete(generateJobs)
        .where(and(eq(generateJobs.id, jobId), eq(generateJobs.campaignId, campaign)))
        .run();
    }
    return written;
  });
}

/**
 * A non-empty body gets its closing newline. The text is handed to a
 * markdown editor and to the generator's prompt, and a body without its
 * final newline made the next appended section run into the last line.
 * EXISTING trailing newlines are left alone, so a read/write roundtrip
 * changes nothing; an empty body stays empty.
 */
function normalizeBody(markdown: string): string {
  return markdown === "" || markdown.endsWith("\n") ? markdown : `${markdown}\n`;
}

/**
 * The properties patch of one entry, and — when the same request carries a
 * text — the body in the SAME update. `body` is already normalized and
 * `undefined` when the request had none, in which case the column keeps its
 * value.
 */
function patchLocator(
  tx: GrimoireDb,
  campaign: string,
  locator: Locator,
  rev: number,
  patch: Record<string, unknown>,
  body?: string,
): EntryResponse {
  switch (locator.kind) {
    case "campaign": {
      const row = campaignRow(tx, campaign);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardEntryRev(tx, campaign, locator, row.rev, rev, "campaign changed");
      rejectIdPatch(patch, row.id);
      rejectUnknownKeys(patch, CAMPAIGN_KEYS);
      const props = applyPatch(renderCampaign(row).properties, patch);
      const name = asStr(props.name);
      // Accepted by design: a name that EQUALS the id is stored as "" — the
      // empty name means "fall back to the id" everywhere it is rendered
      // (./render, ./read), so the round trip shows the same name back and
      // the row carries no redundant copy of its own key.
      const next: CampaignRow = {
        ...row,
        name: name === row.id ? "" : name,
        description: asOptStr(props.description),
        body: body ?? row.body,
        rev: row.rev + 1,
      };
      tx.update(campaigns)
        .set({
          name: next.name,
          description: next.description,
          body: next.body,
          rev: next.rev,
        })
        .where(eq(campaigns.id, campaign))
        .run();
      indexCampaign(tx, next);
      return renderCampaign(next);
    }
    case "chapter": {
      const row = chapterRowOf(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardEntryRev(tx, campaign, locator, row.rev, rev, "chapter changed");
      rejectIdPatch(patch, row.id);
      rejectUnknownKeys(patch, CHAPTER_KEYS);
      // Only the known trio may be WRITTEN; what is already stored is still
      // shown verbatim.
      assertChapterStatus(patch);
      const props = applyPatch(renderChapter(row).properties, patch);
      const next: ChapterRow = {
        ...row,
        title: asStr(props.title, row.id),
        status: asOptStr(props.status),
        body: body ?? row.body,
        rev: row.rev + 1,
      };
      // Setting `active` HERE performs the same swap the dedicated endpoint
      // does, in this transaction: the properties dialog must not be a way
      // past the one-active rule.
      if (next.status === CHAPTER_ACTIVE) clearOtherActiveChapters(tx, campaign, row.id);
      tx.update(chapters)
        .set({ title: next.title, status: next.status, body: next.body, rev: next.rev })
        .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, row.id)))
        .run();
      indexChapter(tx, campaign, next);
      return renderChapter(next);
    }
    case "scene": {
      const row = sceneRowAt(tx, campaign, locator);
      guardEntryRev(tx, campaign, locator, row.rev, rev, "scene changed");
      rejectIdPatch(patch, row.id);
      rejectUnknownKeys(patch, SCENE_KEYS);
      // Only the known values may be WRITTEN; what is already stored is still
      // shown verbatim.
      assertSceneClosedFields(patch);
      const before = renderScene(
        row,
        refNpcs(tx, campaign, row.id),
        refTags(tx, campaign, row.id),
      );
      const props = applyPatch(before.properties, patch);
      const npcRefs = asStrArray(props.npcs);
      const tags = asStrArray(props.tags);
      // The chapter a scene belongs to is part of its ADDRESS (the path), so
      // a patch may MOVE the scene — but only into a chapter that exists. It
      // cannot be removed: a scene without a chapter has no address.
      const declared: string | null = asOptStr(props.chapter);
      if (declared === null) {
        throw new ApiError(400, "chapter cannot be removed — a scene belongs to a chapter", {
          code: "chapter_required",
        });
      }
      // Every reference first, so a save that names something unknown is
      // refused before anything is written.
      assertChapterRef(tx, campaign, declared);
      const nextLocation = sceneLocation(props.location);
      assertLocationRef(tx, campaign, nextLocation);
      assertNpcRefs(tx, campaign, npcRefs);
      const next: SceneRow = {
        ...row,
        title: asStr(props.title, row.id),
        type: asStr(props.type, "planned"),
        trigger: asOptStr(props.trigger),
        chapterId: declared,
        location: nextLocation,
        status: asStr(props.status, "draft"),
        handouts: packJson(asStrArray(props.handouts)),
        body: body ?? row.body,
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
          rev: next.rev,
        })
        .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, row.id)))
        .run();
      // `location` is also the scene's GROUP, so this is the write that MOVES
      // the scene: the address in the response is built from the new value
      // and the app follows it.
      replaceSceneRefs(tx, campaign, row.id, npcRefs, tags);
      indexScene(tx, campaign, next, tags);
      return renderScene(next, refNpcs(tx, campaign, row.id), refTags(tx, campaign, row.id));
    }
    case "npc": {
      const row = npcRowOf(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardEntryRev(tx, campaign, locator, row.rev, rev, "npc changed");
      rejectIdPatch(patch, row.id);
      rejectUnknownKeys(patch, NPC_KEYS);
      assertNpcStatus(patch);
      const props = applyPatch(renderNpc(row).properties, patch);
      const quickstats = asMap(props.quickstats);
      const npcChapter = asOptStr(props.chapter);
      assertChapterRef(tx, campaign, npcChapter);
      const next: NpcRow = {
        ...row,
        name: asStr(props.name, row.id),
        role: asOptStr(props.role),
        chapterId: npcChapter,
        status: asStr(props.status, NPC_DEFAULT_STATUS),
        statblock: asOptStr(props.statblock),
        quickstats: packJson(quickstats),
        voice: asOptStr(props.voice),
        appearance: asOptStr(props.appearance),
        body: body ?? row.body,
        rev: row.rev + 1,
      };
      tx.update(npcs)
        .set({
          name: next.name,
          role: next.role,
          chapterId: next.chapterId,
          status: next.status,
          statblock: next.statblock,
          quickstats: next.quickstats,
          voice: next.voice,
          appearance: next.appearance,
          body: next.body,
          rev: next.rev,
        })
        .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, row.id)))
        .run();
      indexNpc(tx, campaign, next);
      return renderNpc(next);
    }
    case "location": {
      const row = locationRowOf(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardEntryRev(tx, campaign, locator, row.rev, rev, "location changed");
      rejectIdPatch(patch, row.id);
      rejectUnknownKeys(patch, LOCATION_KEYS);
      const props = applyPatch(renderLocation(row).properties, patch);
      const locationChapter = asOptStr(props.chapter);
      assertChapterRef(tx, campaign, locationChapter);
      const next: LocationRow = {
        ...row,
        name: asStr(props.name, row.id),
        chapterId: locationChapter,
        roll20Page: asOptStr(props["roll20-page"]),
        body: body ?? row.body,
        rev: row.rev + 1,
      };
      tx.update(locations)
        .set({
          name: next.name,
          chapterId: next.chapterId,
          roll20Page: next.roll20Page,
          body: next.body,
          rev: next.rev,
        })
        .where(and(eq(locations.campaignId, campaign), eq(locations.id, row.id)))
        .run();
      indexLocation(tx, campaign, next);
      return renderLocation(next);
    }
  }
}



// --- the body half of a write ----------------------------------------------

/**
 * The body write, INSIDE the caller's transaction — `patchEntry` runs it
 * together with the properties patch, against one rev guard, because two
 * `mutate` calls would be two transactions.
 *
 * `body` is already normalized (`normalizeBody`).
 */
function writeBodyIn(
  tx: GrimoireDb,
  campaign: string,
  locator: Locator,
  rev: number,
  body: string,
): EntryResponse {
  switch (locator.kind) {
    case "campaign": {
      const row = campaignRow(tx, campaign);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardEntryRev(tx, campaign, locator, row.rev, rev, "campaign changed");
      const next: CampaignRow = { ...row, body, rev: row.rev + 1 };
      tx.update(campaigns)
        .set({ body: next.body, rev: next.rev })
        .where(eq(campaigns.id, campaign))
        .run();
      indexCampaign(tx, next);
      return renderCampaign(next);
    }
    case "chapter": {
      const row = chapterRowOf(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardEntryRev(tx, campaign, locator, row.rev, rev, "chapter changed");
      const next: ChapterRow = { ...row, body, rev: row.rev + 1 };
      tx.update(chapters)
        .set({ body: next.body, rev: next.rev })
        .where(and(eq(chapters.campaignId, campaign), eq(chapters.id, row.id)))
        .run();
      indexChapter(tx, campaign, next);
      return renderChapter(next);
    }
    case "scene": {
      const row = sceneRowAt(tx, campaign, locator);
      guardEntryRev(tx, campaign, locator, row.rev, rev, "scene changed");
      const next: SceneRow = { ...row, body, rev: row.rev + 1 };
      tx.update(scenes)
        .set({ body: next.body, rev: next.rev })
        .where(and(eq(scenes.campaignId, campaign), eq(scenes.id, row.id)))
        .run();
      const tags = refTags(tx, campaign, row.id);
      indexScene(tx, campaign, next, tags);
      return renderScene(next, refNpcs(tx, campaign, row.id), tags);
    }
    case "npc": {
      const row = npcRowOf(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardEntryRev(tx, campaign, locator, row.rev, rev, "npc changed");
      // The whole text is stored as it was written, `## Beziehungen`
      // included: nothing in the storage is derived from body text.
      const next: NpcRow = { ...row, body, rev: row.rev + 1 };
      tx.update(npcs)
        .set({ body: next.body, rev: next.rev })
        .where(and(eq(npcs.campaignId, campaign), eq(npcs.id, row.id)))
        .run();
      indexNpc(tx, campaign, next);
      return renderNpc(next);
    }
    case "location": {
      const row = locationRowOf(tx, campaign, locator.id);
      if (row === undefined) throw new ApiError(404, "entry not found");
      guardEntryRev(tx, campaign, locator, row.rev, rev, "location changed");
      const next: LocationRow = { ...row, body, rev: row.rev + 1 };
      tx.update(locations)
        .set({ body: next.body, rev: next.rev })
        .where(and(eq(locations.campaignId, campaign), eq(locations.id, row.id)))
        .run();
      indexLocation(tx, campaign, next);
      return renderLocation(next);
    }
    default:
      throw new ApiError(404, "entry not found");
  }
}













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
 * Insert one generated entity (scene, npc, location stub or a new chapter's
 * metadata) — the database half of `POST /generate/apply`. The caller has
 * already validated everything and checked for conflicts; this is the write.
 */
export function insertDraft(tx: GrimoireDb, campaign: string, draft: EntityDraft): void {
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
      const pos =
        (tx
          .select({ pos: scenes.pos })
          .from(scenes)
          .where(eq(scenes.campaignId, campaign))
          .orderBy(desc(scenes.pos))
          .limit(1)
          .all()[0]?.pos ?? -1) + 1;
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
  jobId?: string,
  /**
   * A PARTIAL accept does not discard the job — it records what
   * it wrote on it and deletes the row only when nothing is left open. That
   * bookkeeping belongs in THIS transaction for the same reason the discard
   * does: after a crash the job and the entries it produced must not
   * disagree. When it is given it replaces the `jobId` discard entirely.
   */
  onWritten?: (tx: GrimoireDb) => void,
): Promise<void> {
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
      for (const draft of inReferenceOrder(drafts)) insertDraft(tx, campaign, draft);
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
