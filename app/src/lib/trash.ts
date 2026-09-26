// What the trash page shows about a row beside its name: how many days it has
// left before the server removes it for good (decisions/trash).
//
// The server purges a row once the retention has passed since it went to the
// trash, counted on its calendar; the page counts the calendar days from
// today to that moment. A row whose last day is today reads 0.

import { TRASH_RETENTION_DAYS } from "@grimoire/shared/trash";
import { addDays, differenceInCalendarDays } from "date-fns";

/** The calendar days left before a row that went to the trash at `deletedMs` is removed for good. */
export function daysUntilPurge(deletedMs: number, now: Date = new Date()): number {
  const purge = addDays(new Date(deletedMs), TRASH_RETENTION_DAYS);
  return Math.max(0, differenceInCalendarDays(purge, now));
}
