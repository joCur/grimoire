// A LOCATION — its one zod schema and the forms derived from it (ADR #31).
//
// `locationSchema` is the location as `GET /api/campaigns/:c/locations/:id`
// answers it. The TypeScript type, the PATCH the resource accepts, the
// location a fixture holds and a generator run proposes, and the generator's
// reply are each derived from it below with zod's own API, so a new field of
// a location is one line in the schema and one in its form fields.
//
// The app edits a location with its own form fields, typed against the type
// derived here (app/src/location/), so a field the form does not handle does
// not compile.

import { z } from "zod";

/**
 * A location, exactly as `GET /api/campaigns/:c/locations/:id` answers it:
 * `id` its stable key, `name` the display name (the id stands in for a
 * location that has none), `chapter` the chapter it belongs to, `roll20Page`
 * the Roll20 page it refers to (never a copy of the map), `atmosphere` what
 * the place gives away about itself — shown on the location card and in the
 * reference preview —, `body` its markdown, and `rev` the row version a PATCH
 * sends back as its guard.
 */
export const locationSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  chapter: z.string().optional(),
  roll20Page: z.string().optional(),
  atmosphere: z.string().optional(),
  body: z.string(),
  rev: z.number(),
});

export type Location = z.infer<typeof locationSchema>;

/** The fields of a location by name, its guard aside. */
export type LocationFields = Omit<Location, "rev">;

/**
 * A location without its guard: what a fixture holds
 * (`fixtures/<campaign>/locations/<id>.json`), what a generator run proposes
 * and what accepting that proposal writes.
 */
export const locationProposalSchema = locationSchema.omit({ rev: true });

export type LocationProposal = z.infer<typeof locationProposalSchema>;

/**
 * The body of `PATCH /api/campaigns/:c/locations/:id`: the guard, the
 * optional `force`, and any subset of the fields — `body` is one of them, and
 * `null` clears an optional one. The id may be echoed, never changed. Strict
 * like the schema it comes from: a key that is none of these is a 400 naming
 * it.
 */
export const locationPatchSchema = locationProposalSchema
  .extend({
    chapter: z.string().nullable(),
    roll20Page: z.string().nullable(),
    atmosphere: z.string().nullable(),
  })
  .partial()
  .extend({ rev: z.number(), force: z.boolean().optional() });

export type LocationPatch = z.infer<typeof locationPatchSchema>;

/** The fields of one location write, guard and `force` aside — what an editing surface builds. */
export const locationChangeSchema = locationPatchSchema.omit({ rev: true, force: true });

export type LocationChange = z.infer<typeof locationChangeSchema>;

/**
 * The reply of a location call, in the strict form a provider enforces: the
 * proposed location with every optional field nullable instead — the model
 * says „not given" with `null` — and the model's `warnings` for the DM beside
 * the fields. Create and augment runs share it; a location has no field a run
 * narrows.
 */
export const locationReplySchema = locationProposalSchema.extend({
  chapter: z.string().nullable(),
  roll20Page: z.string().nullable(),
  atmosphere: z.string().nullable(),
  warnings: z.array(z.string()),
});

export type LocationReplyObject = z.infer<typeof locationReplySchema>;

/**
 * A location reply as the proposal it stands for, the one conversion every
 * run uses: the location without its guard — an optional field the model
 * answered with `null` is absent, never `null` — and the model's `warnings`
 * apart from it.
 */
export function locationFromReply(reply: LocationReplyObject): {
  location: LocationProposal;
  warnings: string[];
} {
  const { chapter, roll20Page, atmosphere, warnings, ...fields } = reply;
  return {
    location: {
      ...fields,
      ...(chapter === null ? {} : { chapter }),
      ...(roll20Page === null ? {} : { roll20Page }),
      ...(atmosphere === null ? {} : { atmosphere }),
    },
    warnings,
  };
}
