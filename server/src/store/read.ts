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

import { and, eq } from "drizzle-orm";
import type { EntryResponse } from "@grimoire/shared";
import { ApiError } from "../api-error";
import { assertSafeAddress } from "../addressing";
import { requireCampaign } from "./campaigns";
import { sceneSummaryRow } from "./chapters";
import type { GrimoireDb } from "../db/client";
import { chapters, locations, npcs, scenes } from "../db/schema";
import { getDb } from "./handle";
import { expandBodyRefs } from "./refs";
import { locatorFromPath, type Locator } from "./paths";
import {
  renderCampaign,
  renderChapter,
  renderLocation,
  renderNpc,
  renderScene,
  type CampaignRow,
  type ChapterRow,
  type LocationRow,
  type NpcRow,
  type SceneRow,
} from "./render";









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
