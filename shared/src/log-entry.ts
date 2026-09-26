// A LOG ENTRY — one quick note the DM takes during a session — its one zod
// schema and the forms derived from it (ADR #31).
//
// `logEntrySchema` is the entry as the session embeds it and as
// `POST`/`PATCH /api/campaigns/:c/sessions/:s/log[/:id]` answer it. The
// TypeScript type, the POST and the PATCH the resource accepts, and the entry
// a fixture holds are each derived from it below with zod's own API.
//
// A log entry hangs UNDER its session. The log is append-only: an entry is
// written once, and the one change after that is the review marking it as
// seen (`reviewed`).

import { z } from "zod";

/**
 * A log entry, exactly as the resource answers it: `id` its stable key — an
 * opaque id the server hands out —, `at` the time the note was taken
 * (`HH:mm`, the server's clock), `sceneId` the scene it was taken in (absent
 * when it names none), `text` the note as the DM typed it, hashtags included,
 * `reviewed` whether the review has seen it, and `rev` the row version a
 * PATCH sends back as its guard.
 */
export const logEntrySchema = z.strictObject({
  id: z.string(),
  at: z.string(),
  sceneId: z.string().optional(),
  text: z.string(),
  reviewed: z.boolean(),
  rev: z.number(),
});

export type LogEntry = z.infer<typeof logEntrySchema>;

/**
 * A log entry without its guard: what a session fixture embeds
 * (`fixtures/<campaign>/sessions/<id>.json`) and the seed writes.
 */
export const logEntrySeedSchema = logEntrySchema.omit({ rev: true });

export type LogEntrySeed = z.infer<typeof logEntrySeedSchema>;

/**
 * The body of `POST /api/campaigns/:c/sessions/:s/log`: the note and, when it
 * was taken in one, its scene. The time is the server's.
 */
export const logEntryCreateSchema = logEntrySeedSchema.pick({ text: true, sceneId: true });

export type LogEntryCreate = z.infer<typeof logEntryCreateSchema>;

/**
 * The body of `PATCH /api/campaigns/:c/sessions/:s/log/:id`: the guard, the
 * optional `force`, and `reviewed`. The note itself is written once: a key
 * that is none of these — `text` among them — is a 400 naming it. The id may
 * be echoed, never changed.
 */
export const logEntryPatchSchema = logEntrySeedSchema
  .pick({ id: true, reviewed: true })
  .partial()
  .extend({ rev: z.number(), force: z.boolean().optional() });

export type LogEntryPatch = z.infer<typeof logEntryPatchSchema>;
