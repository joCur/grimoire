// The properties form of a chapter — editing its fields from the app. This
// module is the pure half: which fields it has, what the open form starts
// with, and the PATCH body a save sends. No react, no query imports, so every
// rule here is unit-testable.
//
// Three rules carry the whole thing:
//
//   1. The FIELD LIST comes from @grimoire/shared/property-fields — `id`
//      deliberately absent (it is fixed at creation, ADR #21).
//   2. Only what the DM CHANGED is patched: every key we do not send keeps
//      its value. Sending an unchanged field would be a no-op at best.
//   3. Clearing a field DELETES the key (`null`, the server's delete marker)
//      instead of writing an empty value.
//
// The status is a CHECK constraint of its column (ADR #25), so its select
// offers the closed list and nothing from outside it.

import type { EntityKind } from "@grimoire/shared/types";
import {
  PROPERTY_FIELDS,
  isPropertiesKind,
  type FieldControl,
  type PropertyFieldDef,
} from "@grimoire/shared/property-fields";

import type { FieldOption } from "@/components/fields/SelectField";
import type { Translate } from "@/i18n/format";
import type { MessageKey } from "@/i18n/messages";
import { chapterStatusOptions } from "@/lib/chapter-status";

export interface PropertiesField {
  /** The field key, verbatim. */
  key: string;
  /** The translated label above the control. */
  label: string;
  control: FieldControl;
  /** Quiet line under the control. */
  hint?: string;
  /** A field that cannot be emptied (`title`) — blank blocks the save. */
  required?: boolean;
  /** `select` only: the known value set. */
  options?: readonly FieldOption[];
}

/**
 * The COPY of every field, by key — the one translated half of the table;
 * the list, its order and its controls live in
 * @grimoire/shared/property-fields.
 */
const FIELD_COPY: Record<string, { label: MessageKey; hint?: MessageKey }> = {
  title: { label: "properties.chapter.title.label" },
  status: { label: "properties.chapter.status.label", hint: "properties.chapter.status.hint" },
};

/** One shared field definition plus the copy the dialog renders it with. */
function fieldOf(def: PropertyFieldDef, t: Translate): PropertiesField {
  const copy = FIELD_COPY[def.key];
  return {
    key: def.key,
    control: def.control,
    // A field without copy would be a silent blank label; the key is the
    // honest fallback and the i18n test is what keeps it unused.
    label: copy === undefined ? def.key : t(copy.label),
    ...(def.required === true ? { required: true } : {}),
    ...(copy?.hint === undefined ? {} : { hint: t(copy.hint) }),
    // The same three labels the overview's status control shows, so picking
    // the active option reads identically in both places.
    ...(def.control === "select" ? { options: chapterStatusOptions(t) } : {}),
  };
}

/** The fields of a kind's form, or undefined for a kind without one. */
export function propertiesFieldsFor(
  kind: EntityKind,
  t: Translate,
): readonly PropertiesField[] | undefined {
  if (!isPropertiesKind(kind)) return undefined;
  return PROPERTY_FIELDS[kind].map((def) => fieldOf(def, t));
}

/** The kind's label, used in the dialog title. */
export function propertiesKindLabel(kind: EntityKind, t: Translate): string | undefined {
  return isPropertiesKind(kind) ? t("kind.chapter") : undefined;
}

/** The form's values, one text per field key. */
export type FormValues = Record<string, string>;

/** What the form starts with — the row's current values, field by field. */
export function propertiesFormValues(
  fields: readonly PropertiesField[],
  properties: Record<string, unknown>,
): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    const raw = properties[field.key];
    // A wrong-typed value is an empty field (degrade); untouched, it is
    // never patched, so nothing is lost by that.
    values[field.key] = typeof raw === "string" ? raw : "";
  }
  return values;
}

/**
 * The properties patch: ONLY the fields whose trimmed value actually moved.
 * A field that ended up empty is sent as `null` (the server deletes the key).
 * Keys the form does not know are never in here.
 */
export function propertiesPatch(
  fields: readonly PropertiesField[],
  initial: FormValues,
  current: FormValues,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    const before = (initial[field.key] ?? "").trim();
    const after = (current[field.key] ?? "").trim();
    if (before === after) continue;
    patch[field.key] = after === "" ? null : after;
  }
  return patch;
}

/** True when the open form holds something a save would carry — what the discard guard asks. */
export function hasPropertiesChanges(
  fields: readonly PropertiesField[],
  initial: FormValues,
  current: FormValues,
): boolean {
  return Object.keys(propertiesPatch(fields, initial, current)).length > 0;
}

/** Blank required field = not a save (the row would lose its title). */
export function canSubmitProperties(
  fields: readonly PropertiesField[],
  values: FormValues,
): boolean {
  return fields.every(
    (field) => field.required !== true || (values[field.key] ?? "").trim() !== "",
  );
}
