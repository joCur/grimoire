// A LOCATION — its one zod schema and everything derived from it (ADR #31).
//
// `locationSchema` is the location as `GET /api/campaigns/:c/locations/:id`
// answers it. The TypeScript type, the PATCH the resource accepts, the
// location a fixture holds and a generator run proposes, and the generator's
// reply schema are all forms of it (./schema-forms), so a new field of a
// location is one line in the schema below and one in its form fields.
//
// The FORM FIELDS the app's dialog is built from stand here too, keyed by the
// same field names: which control edits a field, which list a reference picks
// from, and where it is edited. They are typed against the schema, so a field
// without a form entry — or a form entry without a field — does not compile.

import { z } from "zod";
import type { JsonSchema } from "./outline-schema";
import {
  patchForm,
  REPLY_BODY_DESCRIPTION,
  REPLY_ID_DESCRIPTION,
  replyForm,
  replyJsonSchema,
} from "./schema-forms";
import type { PropertyFieldDef } from "./property-fields";

/**
 * The fields of a location beside its guard: `id` its stable key, `name` the
 * display name (the id stands in for a location that has none), `chapter` the
 * chapter it belongs to, `roll20Page` the Roll20 page it refers to (never a
 * copy of the map), `atmosphere` what the place gives away about itself —
 * shown on the location card and in the reference preview — and `body` its
 * markdown text.
 */
const locationFields = {
  id: z.string(),
  name: z.string(),
  chapter: z.string().optional(),
  roll20Page: z.string().optional(),
  atmosphere: z.string().optional(),
  body: z.string(),
};

/** A location, exactly as `GET /api/campaigns/:c/locations/:id` answers it. */
export const locationSchema = z.strictObject({
  ...locationFields,
  /** The row version — the guard token a PATCH sends back. */
  rev: z.number(),
});

export type Location = z.infer<typeof locationSchema>;

/** The fields of a location by name, its guard aside. */
export type LocationFields = z.infer<z.ZodObject<typeof locationFields>>;

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
 * `null` clears an optional one. The id may be echoed, never changed. A key
 * that is none of these is a 400.
 */
export const locationPatchSchema = patchForm(locationFields);

export type LocationPatch = z.infer<typeof locationPatchSchema>;

// --- the form fields ------------------------------------------------------------

/**
 * How the app edits each field, in the order the dialog shows them. `id` is
 * fixed at creation (ADR #21) and `body` has its own editor, so neither is
 * here; `atmosphere` is edited beside the body, not in the dialog
 * (`surface: "text"`, ADR #29).
 */
const LOCATION_FORM: {
  [K in Exclude<keyof LocationFields, "id" | "body">]-?: Omit<PropertyFieldDef, "key">;
} = {
  name: { control: "text", required: true },
  chapter: { control: "reference", source: "chapters" },
  roll20Page: { control: "text" },
  atmosphere: { control: "textarea", surface: "text" },
};

/** The form fields of a location, as a list in dialog order. */
export const LOCATION_FIELDS: readonly PropertyFieldDef[] = Object.entries(LOCATION_FORM).map(
  ([key, def]) => ({ key, ...def }),
);

// --- the generator reply --------------------------------------------------------

/** What the model is told about each field — prompt text, so German. */
const LOCATION_REPLY_FIELDS = {
  id: REPLY_ID_DESCRIPTION,
  chapter: `id aus der Kontextliste oder der Gliederung. ${REPLY_ID_DESCRIPTION}`,
  atmosphere:
    "Was der Ort über sich verrät, in 1–3 Sätzen: Zustand, Geräusche, Gerüche, was auffällt. " +
    "Figuren und Orte mit id aus der Kontextliste als [[id]].",
  body: REPLY_BODY_DESCRIPTION,
};

/**
 * The reply of a location call, per run: `create` proposes a NEW location,
 * `augment` rewrites one that exists. The shape is the same — a location has
 * no field a run narrows — only the name and the description differ.
 */
export const locationReplySchemas = {
  create: replyForm(locationProposalSchema.shape, {
    title: "location",
    description: "Der fertige Ort: alle seine Felder und die Warnungen für den DM.",
    fields: LOCATION_REPLY_FIELDS,
  }),
  augment: replyForm(locationProposalSchema.shape, {
    title: "augmented_location",
    description:
      "Der vollständige ergänzte Ort: alle seine Felder, wie er danach aussehen soll, und die " +
      "Warnungen für den DM.",
    fields: LOCATION_REPLY_FIELDS,
  }),
};

/** Which run a location reply is for — see `locationReplySchemas`. */
export type LocationReplyMode = keyof typeof locationReplySchemas;

/**
 * Name, description and JSON schema of a location call — the shape a provider
 * request carries. Derived on every call, so no request can reach into the
 * next one's payload.
 */
export function locationReplyRequest(mode: LocationReplyMode): {
  name: string;
  description: string;
  schema: JsonSchema;
} {
  const schema = replyJsonSchema(locationReplySchemas[mode]);
  return { name: String(schema.title), description: String(schema.description), schema };
}
