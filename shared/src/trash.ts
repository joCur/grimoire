// The TRASH (decisions/trash): how long a row stays there, and the shape of
// a row a trash or restore refusal names as being in the way.
//
// Server and app read both from here: the server purges a row once the
// retention is over and names the blockers of its 409s in this shape, and the
// app counts the days a row has left and turns the blockers into a sentence.

import { z } from "zod";

/** How many days a row stays in the trash before the server removes it for good. */
export const TRASH_RETENTION_DAYS = 30;

/** The kinds a trash or restore refusal can name as being in the way. */
export const TRASH_BLOCKER_KINDS = ["chapter", "scene", "npc", "location", "log-entry"] as const;

/**
 * One row in the way of a trash or a restore, as the 409 `trash_blocked`,
 * `restore_blocked` and `chapter_in_trash` carry it under `blockers`: its
 * kind, its id and the name the DM knows it by — a log entry by its text,
 * beside its `session`.
 */
export const trashBlockerSchema = z.strictObject({
  kind: z.enum(TRASH_BLOCKER_KINDS),
  id: z.string(),
  name: z.string(),
  session: z.string().optional(),
});

export type TrashBlocker = z.infer<typeof trashBlockerSchema>;

export type TrashBlockerKind = TrashBlocker["kind"];
