// The Ideen-Einwurf: a campaign's inbox, as rows.
//
// One table, one guard token (`campaigns.inbox_rev`) and three operations —
// read the list, append an idea, tick one off. It is a LIST and not an entry
// (ADR #26), so it has no address, no `body` and no markdown anywhere: a row
// is its columns.

import { and, asc, eq } from "drizzle-orm";
import type { InboxResponse } from "@grimoire/shared";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { campaigns, inboxEntries } from "../db/schema";
import { campaignRow, mutate, requireCampaign } from "./campaigns";
import { getDb } from "./handle";
import { renderInbox, type InboxRow } from "./render";
import { nextPos } from "./shared";

export function inboxRows(db: GrimoireDb, campaign: string): InboxRow[] {
  return db
    .select({
      pos: inboxEntries.pos,
      text: inboxEntries.text,
      done: inboxEntries.done,
    })
    .from(inboxEntries)
    .where(eq(inboxEntries.campaignId, campaign))
    .orderBy(asc(inboxEntries.pos))
    .all() as InboxRow[];
}

/**
 * GET /api/campaigns/:campaign/inbox — the ideas plus the LIST's guard token.
 * An empty inbox is an empty list, not a missing one (200).
 */
export async function readInbox(campaign: string): Promise<InboxResponse> {
  const row = await requireCampaign(campaign);
  const db = await getDb();
  return renderInbox(inboxRows(db, campaign), row.inboxRev);
}

/**
 * POST /api/campaigns/:campaign/inbox — append one idea as a row.
 *
 * No heading row is written in front of the first one. A table has no
 * skeleton: `# Inbox` was the title of a text (ADR #26), and a row holding it
 * would read as an idea called "Inbox".
 */
export async function appendInboxEntry(campaign: string, text: string): Promise<InboxResponse> {
  return mutate(campaign, (tx) => {
    tx.insert(inboxEntries)
      .values({
        campaignId: campaign,
        pos: nextPos(inboxRows(tx, campaign)),
        text,
        done: 0,
      })
      .run();
    return renderInbox(inboxRows(tx, campaign), bumpInboxRev(tx, campaign));
  });
}

/** The inbox's own guard token, bumped and returned (`readInbox` above). */
function bumpInboxRev(tx: GrimoireDb, campaign: string): number {
  const next = (campaignRow(tx, campaign)?.inboxRev ?? 0) + 1;
  tx.update(campaigns)
    .set({ inboxRev: next })
    .where(eq(campaigns.id, campaign))
    .run();
  return next;
}

/**
 * POST /api/campaigns/:campaign/review/inbox-done `{ id }` — the one
 * documented exception to the inbox's append-only rule: the idea is ticked
 * off. Idempotent (an idea already done answers unchanged); 404 when the
 * inbox has no row with that id.
 *
 * The id is the row's own (`InboxEntry.id`, the append counter). The review
 * reads the list and sends back what it read, so a miss is a real error —
 * the list moved on, or the caller made the id up.
 */
export async function markInboxLineDone(campaign: string, id: string): Promise<InboxResponse> {
  return mutate(campaign, (tx) => {
    const rows = inboxRows(tx, campaign);
    const rev = campaignRow(tx, campaign)?.inboxRev ?? 1;
    const match = rows.find((row) => String(row.pos) === id);
    if (match === undefined) throw new ApiError(404, "no such idea in the inbox");
    // Already done means an earlier call succeeded. An idempotent repeat
    // writes nothing, so the guard token stays as it is.
    if (match.done !== 0) return renderInbox(rows, rev);
    tx.update(inboxEntries)
      .set({ done: 1 })
      .where(and(eq(inboxEntries.campaignId, campaign), eq(inboxEntries.pos, match.pos)))
      .run();
    return renderInbox(inboxRows(tx, campaign), bumpInboxRev(tx, campaign));
  });
}
