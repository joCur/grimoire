// The boot pass that closes file-era reference holes (issue #70).
//
// The DB model says a referenced entity is never MISSING, only EMPTY (#52):
// every write path creates the row it references (store/write.ts
// `ensureNpcRow`). The stock migrated out of the file tree predates that
// rule, so one idempotent pass per boot materialises what is left — and only
// the references whose meaning is unambiguous. `store/write.ts`
// `backfillReferencedNpcs` carries the reasoning, including why
// `scenes.location` is NOT part of it.
//
// It runs after the schema migrator and the one-time import (store/handle.ts)
// and reports what it created, so a boot that changes data says so out loud
// instead of doing it quietly.

import { eq, sql } from "drizzle-orm";
import type { GrimoireDb } from "../db/client";
import { campaigns } from "../db/schema";
import { backfillReferencedNpcs } from "./write";

export interface RefBackfillOutcome {
  /** `<campaign>/<npc-id>` per created row, in a stable order. */
  created: string[];
}

/**
 * Create an empty npc row for every dangling npc reference in every campaign.
 * One transaction PER CAMPAIGN — a campaign that fails leaves the others
 * done, the same resumability rule the initial migration follows.
 */
export function backfillReferences(db: GrimoireDb): RefBackfillOutcome {
  const created: string[] = [];
  for (const row of db.select({ id: campaigns.id }).from(campaigns).all()) {
    const ids = db.transaction((handle) => {
      const tx = handle as unknown as GrimoireDb;
      const madeIds = backfillReferencedNpcs(tx, row.id);
      // Only a campaign that actually CHANGED bumps its version — an
      // unchanged campaign must not make every polling client refetch on
      // every restart (DECISIONS #9).
      if (madeIds.length > 0) {
        tx.update(campaigns)
          .set({ version: sql`${campaigns.version} + 1` })
          .where(eq(campaigns.id, row.id))
          .run();
      }
      return madeIds;
    }) as string[];
    for (const id of ids) created.push(`${row.id}/${id}`);
  }
  return { created };
}
