// The purge of the trash (decisions/trash).
//
// A row in the trash stays there for a fixed time and is then removed for
// good. Each domain module removes its own expired rows; this module only
// runs them in the order the foreign keys demand, in one transaction, and
// moves the version counter of every campaign it removed rows of
// (decisions/polling), because the trash lists of those campaigns changed.
//
// The order: a scene names npcs, a location and a chapter, npcs and locations
// name a chapter, so scenes go first, then npcs and locations, then chapters
// — whose threads go with them — and the ideas, which name nothing. A row
// that names another went to the trash no later than the row it names (the
// trash refuses a row something live still names, and a restore refuses a row
// whose reference is in the trash), so it expires no later either.

import { format, subDays } from "date-fns";
import type { GrimoireDb } from "../db/client";
import { bumpCampaignVersion } from "./campaigns";
import { purgeChapters } from "./chapters";
import { getDb } from "./handle";
import { purgeIdeas } from "./ideas";
import { purgeLocations } from "./locations";
import { purgeNpcs } from "./npcs";
import { purgeScenes } from "./scenes";
import { LOCAL_DATE_TIME_SECONDS } from "./time";

/** How long a row stays in the trash before the purge removes it. */
export const TRASH_RETENTION_DAYS = 30;

/**
 * Remove every row that went to the trash more than `TRASH_RETENTION_DAYS`
 * before `now`, across all campaigns. Returns how many rows it removed
 * (threads that go with their chapter not counted).
 *
 * The cutoff is `now` minus the retention in the server's wall clock, in the
 * stored shape of a trash moment, which sorts as text in the order of time.
 */
export async function purgeTrash(now: Date = new Date()): Promise<number> {
  const cutoff = format(subDays(now, TRASH_RETENTION_DAYS), LOCAL_DATE_TIME_SECONDS);
  const db = await getDb();
  return db.transaction((handle) => {
    const tx = handle as unknown as GrimoireDb;
    const removed = [
      ...purgeScenes(tx, cutoff),
      ...purgeNpcs(tx, cutoff),
      ...purgeLocations(tx, cutoff),
      ...purgeChapters(tx, cutoff),
      ...purgeIdeas(tx, cutoff),
    ];
    for (const campaign of new Set(removed)) bumpCampaignVersion(tx, campaign);
    return removed.length;
  }) as number;
}
