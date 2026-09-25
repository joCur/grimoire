// The fields of a chapter — which keys it has, what kind of value each one
// holds, and which of them cannot be lost.
//
// The definitions carry only the key, the shape of its value and the known
// value set of a `select`. Everything that is UI — German labels, hints,
// placeholders — stays in the app, where the translator lives. A scene, an
// npc and a location derive everything from their zod schemas instead
// (ADR #31, ./scene.ts, ./npc.ts, ./location.ts).
//
// The order is the order the dialog shows: a contract of its own, not an
// accident.

import { CHAPTER_STATUSES } from "./types";

/** The kinds whose fields are described field by field. */
export const PROPERTY_KINDS = ["chapter"] as const;
export type PropertiesKind = (typeof PROPERTY_KINDS)[number];

export function isPropertiesKind(value: string): value is PropertiesKind {
  return (PROPERTY_KINDS as readonly string[]).includes(value);
}

/**
 * How one field's VALUE is shaped — and, in the app, which control edits it:
 *
 *   text     a free string
 *   select   a string out of a known value set, plus whatever a hand-edited
 *            value happens to say (the format degrades)
 */
export type FieldControl = "text" | "select";

/** One field of one kind — the shape, never the copy. */
export interface PropertyFieldDef {
  /** The field key, verbatim. */
  key: string;
  control: FieldControl;
  /** `select` only: the known value set. */
  values?: readonly string[];
  /** A field that cannot be lost (`title`) — never blank. */
  required?: boolean;
}

/** `id` is deliberately NOT in any list: it is fixed at creation (ADR #21). */
export const PROPERTY_FIELDS: Record<PropertiesKind, readonly PropertyFieldDef[]> = {
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
