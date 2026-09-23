// A LOCATION — its one zod schema and everything derived from it (ADR #31).
//
// `locationSchema` is the entry as the API answers it. The TypeScript type,
// the PATCH the write path accepts, the DRAFT a fixture holds and the
// generator proposes, and the generator's reply schema are all forms of it
// (./entry-form), so a new field of a location is one line in the schema
// below and one in its field description.
//
// The field DESCRIPTION the „Eigenschaften" dialog is built from stands here
// too, keyed by the same field names: which control edits a field, which
// list a reference picks from, and where it is edited. It is typed against
// the schema, so a field without a description — or a description without a
// field — does not compile.

import { z } from "zod";
import { patchForm, REPLY_BODY_DESCRIPTION, REPLY_ID_DESCRIPTION, replyForm } from "./entry-form";
import type { PropertyFieldDef } from "./property-fields";

/**
 * The fields of a location — its properties: everything but the id, the
 * text and the guard. `name` is the display name (the id stands in for a
 * location that has none), `chapter` the chapter it belongs to,
 * `roll20-page` the Roll20 page it refers to (never a copy of the map), and
 * `atmosphere` what the place gives away about itself, shown on the location
 * card and in the reference preview.
 */
const locationFields = {
  name: z.string(),
  chapter: z.string().optional(),
  "roll20-page": z.string().optional(),
  atmosphere: z.string().optional(),
};

/** A location entry, exactly as `GET …/entries/locations/<id>` answers it. */
export const locationSchema = z.strictObject({
  kind: z.literal("location"),
  id: z.string(),
  /** The entry's address, `locations/<id>` (server/src/store/paths.ts). */
  path: z.string(),
  ...locationFields,
  /** The markdown text. */
  body: z.string(),
  /** The row version — the guard token a write sends back. */
  rev: z.number(),
});

export type Location = z.infer<typeof locationSchema>;

/** The properties of a location, by name — the part a dialog edits. */
export type LocationFields = z.infer<z.ZodObject<typeof locationFields>>;

/**
 * A location that is not stored yet: the entry without its address and its
 * guard. What a fixture holds, what the generator proposes and what the
 * accept writes.
 */
export const locationDraftSchema = locationSchema.omit({ path: true, rev: true });

export type LocationDraft = z.infer<typeof locationDraftSchema>;

/**
 * The body of `PATCH …/entries/locations/<id>`: the guard, the optional
 * `force` and text, and any subset of the fields — `null` clears an optional
 * one. A key that is none of these is a 400.
 */
export const locationPatchSchema = patchForm(locationFields);

export type LocationPatch = z.infer<typeof locationPatchSchema>;

// --- the „Eigenschaften" dialog ----------------------------------------------

/**
 * How the app edits each field, in the order the dialog shows them. The
 * prose field `atmosphere` is edited beside the text, not in the dialog
 * (`surface: "text"`, ADR #29).
 */
const LOCATION_FIELD_DEFS: { [K in keyof LocationFields]-?: Omit<PropertyFieldDef, "key"> } = {
  name: { control: "text", required: true },
  chapter: { control: "reference", source: "chapters" },
  "roll20-page": { control: "text" },
  atmosphere: { control: "textarea", surface: "text" },
};

/** The field description of a location, as a list in dialog order. */
export const LOCATION_FIELDS: readonly PropertyFieldDef[] = Object.entries(LOCATION_FIELD_DEFS).map(
  ([key, def]) => ({ key, ...def }),
);

// --- the generator reply ---------------------------------------------------

/** What the model is told about each field — prompt text, so German. */
const LOCATION_REPLY_FIELDS = {
  id: REPLY_ID_DESCRIPTION,
  chapter: `id aus der Kontextliste oder der Gliederung. ${REPLY_ID_DESCRIPTION}`,
  atmosphere:
    "Was der Ort über sich verrät, in 1–3 Sätzen: Zustand, Geräusche, Gerüche, was auffällt. " +
    "Figuren und Orte mit id aus der Kontextliste als [[id]].",
  body: REPLY_BODY_DESCRIPTION,
};

/** The draft's own keys in a reply: `kind` is the call's, not the model's. */
const locationReplyDraft = locationDraftSchema.omit({ kind: true }).shape;

/**
 * The reply of a location call, per run: `create` proposes a NEW location,
 * `augment` rewrites one that exists. The shape is the same — a location has
 * no field a run narrows — only the name and the description differ.
 */
export const locationReplySchemas = {
  create: replyForm(locationReplyDraft, {
    title: "location",
    description:
      "Der fertige Ort: seine Eigenschaften als eigene Felder, der Fließtext und die " +
      "Warnungen für den DM.",
    fields: LOCATION_REPLY_FIELDS,
  }),
  augment: replyForm(locationReplyDraft, {
    title: "augmented_location",
    description:
      "Der vollständige ergänzte Eintrag (Ort): seine Eigenschaften als eigene Felder, der " +
      "ganze Fließtext und die Warnungen für den DM.",
    fields: LOCATION_REPLY_FIELDS,
  }),
};
