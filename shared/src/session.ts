// A SESSION — one evening at the table — its one zod schema and the forms
// derived from it (ADR #31).
//
// `sessionSchema` is the session as `GET /api/campaigns/:c/sessions/:id`
// answers it: its own fields with its children embedded — the pauses
// (./pause.ts) and the log (./log-entry.ts). The children do not exist
// without their session, and each is written on its own resource under it; a
// session write never touches them. The TypeScript type, the POST, the PATCH
// and the DELETE the resource accepts, and the session a fixture holds are
// each derived from it below with zod's own API.
//
// TIME. `started` and `ended` are zone-less wall-clock strings read in the
// SERVER's timezone, and `startedMs`/`endedMs` are the server's epoch reading
// of them. Only the server knows which wall clock those digits belong to, so
// a client computes with the epoch values alone and writes a moment as an
// epoch value too. A session that runs past midnight simply keeps running:
// nothing about it depends on the calendar day.

import { z } from "zod";
import { logEntrySchema, logEntrySeedSchema } from "./log-entry";
import { pauseSchema, pauseSeedSchema } from "./pause";

/**
 * A session, exactly as the resource answers it:
 *
 *   - `id` its stable key, an opaque id the server hands out;
 *   - `started` when it began (`yyyy-mm-ddTHH:MM:SS`, local to the server,
 *     empty when never set) beside its epoch reading `startedMs`;
 *   - `ended` when it was ended beside `endedMs` — both absent while the
 *     session runs;
 *   - `body` the session's free Markdown text;
 *   - `pauses` and `log` its children, each in the order it was written;
 *   - `rev` the row version a PATCH or a DELETE sends back as its guard. It
 *     guards the session's own fields: a child carries its own.
 *
 * An epoch reading is absent when the server cannot read its string.
 */
export const sessionSchema = z.strictObject({
  id: z.string(),
  started: z.string(),
  startedMs: z.number().optional(),
  ended: z.string().optional(),
  endedMs: z.number().optional(),
  body: z.string(),
  pauses: z.array(pauseSchema),
  log: z.array(logEntrySchema),
  rev: z.number(),
});

export type Session = z.infer<typeof sessionSchema>;

/**
 * A session as its fixture holds it (`fixtures/<campaign>/sessions/<id>.json`)
 * and the seed writes it: without the guards and without the epoch readings,
 * which are the server's reading of the strings in its own timezone and not
 * something a fixture could state. Its children are embedded in their own
 * fixture form.
 */
export const sessionSeedSchema = sessionSchema
  .omit({ rev: true, startedMs: true, endedMs: true })
  .extend({
    pauses: z.array(pauseSeedSchema),
    log: z.array(logEntrySeedSchema),
  });

export type SessionSeed = z.infer<typeof sessionSeedSchema>;

/**
 * The body of `POST /api/campaigns/:c/sessions`: nothing. A new session
 * starts now, on the server's clock.
 */
export const sessionCreateSchema = sessionSchema.pick({});

export type SessionCreate = z.infer<typeof sessionCreateSchema>;

/**
 * The body of `PATCH /api/campaigns/:c/sessions/:id`: the guard, the optional
 * `force`, and its two moments as epoch values — `endedMs` ends the session,
 * `endedMs: null` lets it run again, and `startedMs` corrects its start. The
 * server stores the reading of that moment in its own timezone. The id may be
 * echoed, never changed. Strict like the schema it comes from: a key that is
 * none of these — the strings `started` and `ended`, and the children, among
 * them — is a 400 naming it.
 */
export const sessionPatchSchema = sessionSchema
  .pick({ id: true, startedMs: true })
  .partial()
  .extend({
    endedMs: sessionSchema.shape.endedMs.nullable(),
    rev: z.number(),
    force: z.boolean().optional(),
  });

export type SessionPatch = z.infer<typeof sessionPatchSchema>;

/**
 * The body of `DELETE /api/campaigns/:c/sessions/:id`: the guard the session
 * was read with.
 */
export const sessionDeleteSchema = sessionSchema.pick({ rev: true });

export type SessionDelete = z.infer<typeof sessionDeleteSchema>;

/**
 * A session in the campaign tree: when it ran, and nothing of its children.
 */
export const sessionSummarySchema = sessionSchema.pick({
  id: true,
  started: true,
  startedMs: true,
  ended: true,
  endedMs: true,
});

export type SessionSummary = z.infer<typeof sessionSummarySchema>;

/**
 * True when the session is ended. A BLANK `ended` counts as not set: the
 * session runs and can be ended normally.
 */
export function isSessionEnded(session: { ended?: string | null }): boolean {
  return session.ended !== undefined && session.ended !== null && session.ended.trim() !== "";
}

/**
 * True when a session holds nothing the DM would miss: no log entry and a
 * text of nothing but headings and blank lines. Only such a session may be
 * deleted; one with content is ended, not deleted.
 */
export function isSessionEmpty(session: Pick<Session, "log" | "body">): boolean {
  if (session.log.length > 0) return false;
  return session.body
    .split(/\r?\n/)
    .every((line) => line.trim() === "" || /^#{1,6}(\s|$)/.test(line.trim()));
}
