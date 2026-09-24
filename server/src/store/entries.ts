// An entry, read and written through its address.
//
// Three kinds are reached this way — campaign, chapter, scene — and they
// share exactly one read (`readEntry`) and exactly one write (`patchEntry`,
// ADR #23): fields, text, or both, in ONE transaction against ONE `rev`. The
// property contract per kind is its own module (./properties.ts), because the
// seed reads it too.
//
// An npc and a location are each their own resource (ADR #31, ./npcs.ts,
// ./locations.ts): an address that names one answers 404 here. Lists have no
// address and no case in either switch (ADR #26).

import { and, eq } from "drizzle-orm";
import type { EntryResponse, PatchEntryRequest } from "@grimoire/shared";
import { ApiError } from "../api-error";
import { assertSafeAddress } from "../addressing";
import type { GrimoireDb } from "../db/client";
import { campaigns, chapters, generateJobs, packJson, scenes } from "../db/schema";
import {
  campaignRow,
  indexCampaign,
  mutate,
  readCampaignEntry,
  requireCampaign,
  requireCampaignRow,
} from "./campaigns";
import {
  CHAPTER_ACTIVE,
  clearOtherActiveChapters,
  nextScenePos,
  readChapterEntry,
  readSceneEntry,
  replaceSceneRefs,
  sceneLocation,
} from "./chapters";
import {
  assertChapterRef,
  assertLocationRef,
  assertNpcRefs,
  chapterRowOf,
  indexChapter,
  indexScene,
  refNpcs,
  refTags,
  sceneRowAt,
} from "./entity-rows";
import { getDb } from "./handle";
import { locatorFromPath, type Locator } from "./paths";
import {
  applyPatch,
  CAMPAIGN_KEYS,
  CHAPTER_KEYS,
  rejectIdPatch,
  rejectUnknownKeys,
  SCENE_KEYS,
} from "./properties";
import {
  renderCampaign,
  renderChapter,
  renderScene,
  type CampaignRow,
  type ChapterRow,
  type SceneRow,
} from "./render";
import {
  asOptStr,
  asStr,
  asStrArray,
  assertChapterStatus,
  assertSceneClosedFields,
  normalizeBody,
  revConflict,
} from "./shared";

// --- reading one entry --------------------------------------------------------

/**
 * Render the entry a campaign-relative path addresses, by handing the id to
 * the domain module that owns the kind. Each of them answers the same 404
 * when the campaign has no row with that id.
 *
 * A session, the inbox and the glossary have no address (ADR #26), so
 * `locatorFromPath` already answered 404 for them and this switch has no case
 * to spend on a list. An npc and a location are each their own resource
 * (ADR #31), so an address that names one is a 404 too.
 */
export function readByLocator(
  db: GrimoireDb,
  campaignRowValue: CampaignRow,
  locator: Locator,
): EntryResponse {
  const campaign = campaignRowValue.id;
  switch (locator.kind) {
    case "campaign":
      return readCampaignEntry(campaignRowValue);
    case "chapter":
      return readChapterEntry(db, campaign, locator.id);
    case "scene":
      return readSceneEntry(db, campaign, locator.id);
  }
}

/** GET /api/campaigns/:campaign/entries/<address> */
export async function readEntry(campaign: string, rel: string): Promise<EntryResponse> {
  const row = await requireCampaign(campaign);
  assertSafeAddress(rel); // 400 unsafe id/address
  const db = await getDb();
  return readByLocator(db, row, locatorFromPath(rel));
}

// --- the rev guard of an addressed entry --------------------------------------

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
  throw revConflict(current, what, {
    entry: readByLocator(tx, requireCampaignRow(tx, campaign), locator),
  });
}

// --- PATCH /api/campaigns/:campaign/entries/<address> -------------------------

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
 *
 * An address that names an npc or a location is a 404: each is written
 * through its own resource (ADR #31).
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
      // (./render), so the round trip shows the same name back and
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
      // A scene that CHANGES chapter lands at the end of the new one: its
      // old position counted among other siblings and means nothing here,
      // and the target chapter's order is the DM's — a scene arriving in the
      // middle of it would move without anybody saying where. Staying in the
      // chapter leaves `pos` untouched, so an ordinary save does not
      // reshuffle anything.
      const nextPosValue =
        declared === row.chapterId ? row.pos : nextScenePos(tx, campaign, declared);
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
        pos: nextPosValue,
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
      // `location` is also the scene's GROUP, so this is the write that MOVES
      // the scene: the address in the response is built from the new value
      // and the app follows it.
      replaceSceneRefs(tx, campaign, row.id, npcRefs, tags);
      indexScene(tx, campaign, next, tags);
      return renderScene(next, refNpcs(tx, campaign, row.id), refTags(tx, campaign, row.id));
    }
  }
}

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
  }
}
