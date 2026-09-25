// A CAMPAIGN — its one zod schema and the forms derived from it (ADR #31).
//
// `campaignSchema` is the campaign as `GET /api/campaigns/:c` answers it. The
// TypeScript type, the PATCH and the POST the resource accepts, and the
// campaign a fixture holds are each derived from it below with zod's own
// API, so a new field of a campaign is one line in the schema and one in its
// form fields.
//
// The campaign list (`GET /api/campaigns`) is not the campaign: it answers
// `CampaignSummary`, which carries the newest session beside the name
// (./types.ts).

import { z } from "zod";

/**
 * A campaign, exactly as `GET /api/campaigns/:c` answers it: `id` its stable
 * key — the one in every URL —, `name` the display name (the id stands in
 * for a campaign that has none), `description` a one-line summary, `body`
 * its markdown — free notes for the whole campaign —, and `rev` the row
 * version a PATCH sends back as its guard.
 */
export const campaignSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  body: z.string(),
  rev: z.number(),
});

export type Campaign = z.infer<typeof campaignSchema>;

/**
 * A campaign without its guard: what a fixture holds
 * (`fixtures/<campaign>/campaigns/<id>.json`) and the seed writes.
 */
export const campaignSeedSchema = campaignSchema.omit({ rev: true });

export type CampaignSeed = z.infer<typeof campaignSeedSchema>;

/**
 * The body of `PATCH /api/campaigns/:c`: the guard, the optional `force`, and
 * any subset of the fields — `body` is one of them, and `null` clears the
 * description. The id may be echoed, never changed. Strict like the schema it
 * comes from: a key that is none of these is a 400 naming it.
 */
export const campaignPatchSchema = campaignSeedSchema
  .extend({ description: z.string().nullable() })
  .partial()
  .extend({ rev: z.number(), force: z.boolean().optional() });

export type CampaignPatch = z.infer<typeof campaignPatchSchema>;

/** The fields of one campaign write, guard and `force` aside — what an editing surface builds. */
export const campaignChangeSchema = campaignPatchSchema.omit({ rev: true, force: true });

export type CampaignChange = z.infer<typeof campaignChangeSchema>;

/**
 * The body of `POST /api/campaigns`: the typed name, the one-line
 * description, and the id the DM set (absent: derived from the name).
 */
export const campaignCreateSchema = campaignSeedSchema
  .pick({ name: true, description: true })
  .extend({ id: z.string().optional() });

export type CampaignCreate = z.infer<typeof campaignCreateSchema>;
