// The fields of a scene and a chapter — which keys each has, what kind of
// value each one holds, and which of them cannot be lost.
//
// The list lives here, and not in the app's „Eigenschaften" dialog, because
// the GENERATOR needs the very same list for a scene: its reply is a JSON
// object whose fields are schema-enforced, and a schema that allowed a key
// the dialog does not know — or forgot one it offers — would be a model
// writing fields the DM can never see or edit. The npc and the location
// derive everything from their zod schemas instead (ADR #31, ./npc.ts,
// ./location.ts).
//
// This is the one place server and app both import, and the definitions carry
// only what both need: the key, the shape of its value, and the known value
// set of a `select`. Everything that is UI —
// German labels, hints, placeholders, which tree list a reference field
// offers to pick from — stays in the app, where the translator lives.
//
// The order is the order the dialog shows (and the order the fields are
// answered in): a contract of its own, not an accident.

import { CHAPTER_STATUSES, SCENE_STATUSES, SCENE_TYPES } from "./types";

/** The kinds whose fields are described field by field. */
export const PROPERTY_KINDS = ["scene", "chapter"] as const;
export type PropertiesKind = (typeof PROPERTY_KINDS)[number];

export function isPropertiesKind(value: string): value is PropertiesKind {
  return (PROPERTY_KINDS as readonly string[]).includes(value);
}

/**
 * How one field's VALUE is shaped — and, in the app, which control edits it:
 *
 *   text / textarea   a free string (textarea = the fields that hold a
 *                     sentence; the difference is presentation only)
 *   select            a string out of a known value set, plus whatever a
 *                     hand-edited value happens to say (the format degrades)
 *   reference         ONE id
 *   references        MANY ids
 *   chips             a free string list (`tags`, `handouts`)
 */
export type FieldControl = "text" | "textarea" | "select" | "reference" | "references" | "chips";

/** Which tree list a reference field offers in the dialog (free text stays). */
export type ReferenceSource = "npcs" | "locations" | "chapters";

/** One field of one kind — the shape, never the copy. */
export interface PropertyFieldDef {
  /** The field key, verbatim. */
  key: string;
  control: FieldControl;
  /** `select` only: the known value set. */
  values?: readonly string[];
  /** `reference`/`references` only: which entity list the value names. */
  source?: ReferenceSource;
  /** A field that cannot be lost (`title`) — never blank. */
  required?: boolean;
}

/**
 * `id` is deliberately NOT in any list: it is fixed at creation (ADR #21),
 * and in a scene's generator reply it is required separately
 * (./entry-schema) because it is what the server builds the ADDRESS from —
 * the one thing that is not an editable property.
 */
export const PROPERTY_FIELDS: Record<PropertiesKind, readonly PropertyFieldDef[]> = {
  scene: [
    { key: "title", control: "text", required: true },
    { key: "type", control: "select", values: SCENE_TYPES },
    { key: "trigger", control: "textarea" },
    { key: "chapter", control: "reference", source: "chapters" },
    { key: "location", control: "reference", source: "locations" },
    { key: "npcs", control: "references", source: "npcs" },
    { key: "handouts", control: "chips" },
    { key: "tags", control: "chips" },
    { key: "status", control: "select", values: SCENE_STATUSES },
  ],
  chapter: [
    { key: "title", control: "text", required: true },
    // A KNOWN SET, unlike the other free-text fields: the API accepts only
    // these three values for a chapter status and answers 400 for anything
    // else, so a free-text control could only produce a rejected save. A
    // value a chapter already carries is still shown — the format degrades
    // here like everywhere.
    { key: "status", control: "select", values: CHAPTER_STATUSES },
  ],
};

/** The field list of a kind, or undefined for a kind that has no form. */
export function propertyFieldsFor(kind: string): readonly PropertyFieldDef[] | undefined {
  return isPropertiesKind(kind) ? PROPERTY_FIELDS[kind] : undefined;
}

/** One field of one kind by key, or undefined. */
export function propertyFieldDef(
  kind: PropertiesKind,
  key: string,
): PropertyFieldDef | undefined {
  return PROPERTY_FIELDS[kind].find((field) => field.key === key);
}
