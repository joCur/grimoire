// An IDEA — a line the DM throws in on the go — its one zod schema and the
// forms derived from it (decisions/resources).
//
// `ideaSchema` is the idea as `GET /api/campaigns/:c/ideas/:id` answers it.
// The TypeScript type, the POST and the PATCH the resource accepts, and the
// idea a fixture holds are each derived from it below with zod's own API.
//
// An idea is written once and then only ticked off: its text never changes,
// so the one field a PATCH carries is `done` — beside `deletedMs: null`, which
// takes the idea out of the trash (decisions/trash).

import { z } from "zod";

/**
 * An idea, exactly as `GET /api/campaigns/:c/ideas/:id` answers it: `id` its
 * stable key — an opaque id the server hands out —, `text` the idea as the DM
 * typed it, hashtags included, `done` whether it is ticked off, `deletedMs`
 * when it went to the trash — absent while it is live (decisions/trash) —,
 * and `rev` the row version a PATCH sends back as its guard.
 */
export const ideaSchema = z.strictObject({
  id: z.string(),
  text: z.string(),
  done: z.boolean(),
  deletedMs: z.number().optional(),
  rev: z.number(),
});

export type Idea = z.infer<typeof ideaSchema>;

/**
 * An idea without its guard and without a trash moment: what a fixture holds
 * (`fixtures/<campaign>/ideas/<id>.json`) and the seed writes — a live idea.
 */
export const ideaSeedSchema = ideaSchema.omit({ rev: true, deletedMs: true });

export type IdeaSeed = z.infer<typeof ideaSeedSchema>;

/**
 * The body of `PATCH /api/campaigns/:c/ideas/:id`: the guard, the optional
 * `force`, and `done` — ticking an idea off, or back on. The id may be
 * echoed, never changed. `deletedMs: null` takes the idea out of the trash;
 * putting it there is its DELETE, so no other value is taken. Strict like the
 * schema it comes from: a key that is none of these — `text` among them — is
 * a 400 naming it.
 */
export const ideaPatchSchema = ideaSeedSchema
  .pick({ id: true, done: true })
  .partial()
  .extend({ rev: z.number(), force: z.boolean().optional(), deletedMs: z.null().optional() });

export type IdeaPatch = z.infer<typeof ideaPatchSchema>;

/** The body of `POST /api/campaigns/:c/ideas`: the idea's text. A new idea is open. */
export const ideaCreateSchema = ideaSeedSchema.pick({ text: true });

export type IdeaCreate = z.infer<typeof ideaCreateSchema>;

/**
 * The body of `DELETE /api/campaigns/:c/ideas/:id`, which puts the idea in
 * the trash: the guard the idea was read with.
 */
export const ideaDeleteSchema = ideaSchema.pick({ rev: true });

export type IdeaDelete = z.infer<typeof ideaDeleteSchema>;
