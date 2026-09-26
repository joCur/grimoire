// Keeping the search index current across kinds.
//
// Each domain module writes the index row of its own kind (`indexScene`,
// `indexNpc`, … beside its loader). What crosses kinds lives here: the indexed
// text of a row contains the DISPLAY NAME of everything its body references,
// so a write of one kind makes the index rows of other kinds stale, and
// re-indexing those referrers reaches every kind.

import type { GrimoireDb } from "../db/client";
import { campaignRow, indexCampaign } from "./campaigns";
import { chapterRowOf, indexChapter } from "./chapters";
import { indexLocation, locationRowOf } from "./locations";
import { indexNpc, npcRowOf } from "./npcs";
import { referrersOf, type RefBodyKind } from "./refs";
import { indexScene, refTags, sceneRowOf } from "./scenes";

/**
 * Re-index everything whose BODY references `slug`.
 *
 * The indexed text of a referring row contains the referenced row's DISPLAY
 * NAME (store/refs.ts explains why), so a name or id change makes other rows'
 * index rows stale. Every write of a referenceable row therefore ends here.
 *
 * The `cascading` latch stops the obvious infinite loop: re-indexing a
 * referrer is a write of a referenceable row too, and two rows that mention
 * each other would ping-pong forever. One level is all this needs — the
 * referrer's own name did not change. Safe as a module flag because a
 * transaction is strictly synchronous (see ./campaigns.ts `mutate`).
 */
let cascading = false;

export function reindexReferrers(tx: GrimoireDb, campaign: string, slug: string): void {
  if (cascading) return;
  cascading = true;
  try {
    for (const referrer of referrersOf(tx, campaign, slug)) {
      reindexRow(tx, campaign, referrer.kind, referrer.id);
    }
  } finally {
    cascading = false;
  }
}

/**
 * The prose of a row the index holds as its text: a prose field — an npc's
 * `motivation`, a location's `atmosphere` — ahead of the body, as its own
 * paragraph. Both are text the DM reads on the card, so a search for a word in
 * them finds the row; the same `[[slug]]` expansion runs over both.
 */
export function indexedProse(field: string | null, body: string): string {
  const lead = field?.trim() ?? "";
  return lead === "" ? body : `${lead}\n\n${body}`;
}

/**
 * Re-read one row and rebuild its search-index row from it, title included.
 *
 * Called after a write that changed a name other bodies refer to: their
 * indexed text spells that name out, so it is stale until they are rebuilt.
 *
 * `campaign` is one of the kinds because the campaign's body holds
 * `[[references]]` like any other body (store/refs.ts `REF_BODY_KINDS`), and
 * its index row spells their names out too.
 */
function reindexRow(tx: GrimoireDb, campaign: string, kind: RefBodyKind, id: string): void {
  if (kind === "campaign") {
    const row = campaignRow(tx, campaign);
    if (row !== undefined) indexCampaign(tx, row);
    return;
  }
  if (kind === "npc") {
    const row = npcRowOf(tx, campaign, id);
    if (row !== undefined) indexNpc(tx, campaign, row);
    return;
  }
  if (kind === "location") {
    const row = locationRowOf(tx, campaign, id);
    if (row !== undefined) indexLocation(tx, campaign, row);
    return;
  }
  if (kind === "chapter") {
    const row = chapterRowOf(tx, campaign, id);
    if (row !== undefined) indexChapter(tx, campaign, row);
    return;
  }
  const row = sceneRowOf(tx, campaign, id);
  if (row !== undefined) indexScene(tx, campaign, row, refTags(tx, campaign, id));
}
