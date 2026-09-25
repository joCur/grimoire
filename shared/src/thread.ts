// A THREAD — a storyline the DM keeps track of — its one zod schema and the
// forms derived from it (ADR #31).
//
// `threadSchema` is the thread as `GET /api/campaigns/:c/threads/:id` answers
// it. The TypeScript type, the POST and the PATCH the resource accepts, and
// the thread a fixture holds are each derived from it below with zod's own
// API, so a new field of a thread is one line in the schema.
//
// A thread lies FLAT under its campaign: it belongs to a chapter, and that
// chapter is a field of it, not a segment of its URL.

import { z } from "zod";

/**
 * A thread, exactly as `GET /api/campaigns/:c/threads/:id` answers it: `id`
 * its stable key — an opaque id the server hands out —, `chapter` the id of
 * the chapter that carries it, `text` the storyline in one line, `done`
 * whether the DM has ticked it off, and `rev` the row version a PATCH or a
 * DELETE sends back as its guard.
 */
export const threadSchema = z.strictObject({
  id: z.string(),
  chapter: z.string(),
  text: z.string(),
  done: z.boolean(),
  rev: z.number(),
});

export type Thread = z.infer<typeof threadSchema>;

/**
 * A thread without its guard: what a fixture holds
 * (`fixtures/<campaign>/threads/<id>.json`) and the seed writes.
 */
export const threadSeedSchema = threadSchema.omit({ rev: true });

export type ThreadSeed = z.infer<typeof threadSeedSchema>;

/**
 * The body of `PATCH /api/campaigns/:c/threads/:id`: the guard, the optional
 * `force`, and any subset of the fields — tick or untick (`done`), reword
 * (`text`), move to another chapter (`chapter`). The id may be echoed, never
 * changed. Strict like the schema it comes from: a key that is none of these
 * is a 400 naming it.
 */
export const threadPatchSchema = threadSeedSchema
  .partial()
  .extend({ rev: z.number(), force: z.boolean().optional() });

export type ThreadPatch = z.infer<typeof threadPatchSchema>;

/** The fields of one thread write, guard and `force` aside — what an editing surface builds. */
export const threadChangeSchema = threadPatchSchema.omit({ rev: true, force: true });

export type ThreadChange = z.infer<typeof threadChangeSchema>;

/**
 * The body of `DELETE /api/campaigns/:c/threads/:id`: the guard the thread
 * was read with.
 */
export const threadDeleteSchema = threadSchema.pick({ rev: true });

export type ThreadDelete = z.infer<typeof threadDeleteSchema>;

/**
 * The body of `POST /api/campaigns/:c/threads`: the chapter the thread
 * belongs to and its text. A new thread is open and stands at the end.
 */
export const threadCreateSchema = threadSeedSchema.pick({ chapter: true, text: true });

export type ThreadCreate = z.infer<typeof threadCreateSchema>;
