// A GLOSSARY TERM — how the campaign renders one term of the source material
// — its one zod schema and the forms derived from it (ADR #31).
//
// `glossaryTermSchema` is the term as
// `GET /api/campaigns/:c/glossary-terms/:id` answers it. The TypeScript type,
// the POST and the PATCH the resource accepts, and the term a fixture holds
// are each derived from it below with zod's own API, so a new field of a term
// is one line in the schema.
//
// Terms stand in the order they were created; nothing reorders them. The
// generator quotes them to the model as `term → explanation` lines.

import { z } from "zod";

/**
 * A glossary term, exactly as `GET /api/campaigns/:c/glossary-terms/:id`
 * answers it: `id` its stable key — an opaque id the server hands out —,
 * `term` the wording of the source material (unique within the campaign),
 * `explanation` how this campaign says it, and `rev` the row version a PATCH
 * or a DELETE sends back as its guard.
 */
export const glossaryTermSchema = z.strictObject({
  id: z.string(),
  term: z.string(),
  explanation: z.string(),
  rev: z.number(),
});

export type GlossaryTerm = z.infer<typeof glossaryTermSchema>;

/**
 * A term without its guard: what a fixture holds
 * (`fixtures/<campaign>/glossary-terms/<id>.json`) and the seed writes.
 */
export const glossaryTermSeedSchema = glossaryTermSchema.omit({ rev: true });

export type GlossaryTermSeed = z.infer<typeof glossaryTermSeedSchema>;

/**
 * The body of `PATCH /api/campaigns/:c/glossary-terms/:id`: the guard, the
 * optional `force`, and any subset of the fields. The id may be echoed, never
 * changed. Strict like the schema it comes from: a key that is none of these
 * is a 400 naming it.
 */
export const glossaryTermPatchSchema = glossaryTermSeedSchema
  .partial()
  .extend({ rev: z.number(), force: z.boolean().optional() });

export type GlossaryTermPatch = z.infer<typeof glossaryTermPatchSchema>;

/** The fields of one term write, guard and `force` aside — what an editing surface builds. */
export const glossaryTermChangeSchema = glossaryTermPatchSchema.omit({ rev: true, force: true });

export type GlossaryTermChange = z.infer<typeof glossaryTermChangeSchema>;

/**
 * The body of `DELETE /api/campaigns/:c/glossary-terms/:id`: the guard the
 * term was read with.
 */
export const glossaryTermDeleteSchema = glossaryTermSchema.pick({ rev: true });

export type GlossaryTermDelete = z.infer<typeof glossaryTermDeleteSchema>;

/**
 * The body of `POST /api/campaigns/:c/glossary-terms`: the term and, if the
 * DM has one yet, its explanation. A new term stands at the end.
 */
export const glossaryTermCreateSchema = glossaryTermSeedSchema
  .pick({ term: true, explanation: true })
  .partial({ explanation: true });

export type GlossaryTermCreate = z.infer<typeof glossaryTermCreateSchema>;
