// The form of a location — what the dialog and the edit surface of its
// reading view start with, and the write a save sends. Pure, so every rule is
// unit-testable.
//
// Only what the DM CHANGED is written: a field nobody touched keeps its
// stored value, whitespace around a value is no change, and a field left
// blank clears the value (`null`) instead of writing an empty one. The name
// is the exception — a location always has one, so a blank name is no save.

import type { LocationChange, LocationProposal } from "@grimoire/shared/location";

import { textValue } from "@/components/fields/text";

/**
 * The form's values, one text per field — typed against the location, so a
 * field the form does not handle does not compile. `id` is fixed at creation
 * (ADR #21) and `body` has its own editor.
 */
export type LocationFormValues = {
  [K in Exclude<keyof LocationProposal, "id" | "body">]-?: string;
};

const FIELDS = {
  name: true,
  chapter: true,
  roll20Page: true,
  atmosphere: true,
} satisfies Record<keyof LocationFormValues, true>;

const KEYS = Object.keys(FIELDS) as Array<keyof LocationFormValues>;

/** What the form starts with — the location's current values. */
export function locationFormValues(location: LocationProposal): LocationFormValues {
  return {
    name: location.name,
    chapter: location.chapter ?? "",
    roll20Page: location.roll20Page ?? "",
    atmosphere: location.atmosphere ?? "",
  };
}

/** The fields whose written value moved, blank name included. */
function moved(initial: LocationFormValues, values: LocationFormValues) {
  return KEYS.filter((key) => textValue(initial[key]) !== textValue(values[key]));
}

/** The write: ONLY the fields that moved; a blank name is left out. */
export function locationFormChange(
  initial: LocationFormValues,
  values: LocationFormValues,
): LocationChange {
  const change: LocationChange = {};
  for (const key of moved(initial, values)) {
    const value = textValue(values[key]);
    if (key === "name") {
      if (value !== null) change.name = value;
    } else {
      change[key] = value;
    }
  }
  return change;
}

/** Is there typed work a close would lose? */
export function locationFormDirty(initial: LocationFormValues, values: LocationFormValues): boolean {
  return moved(initial, values).length > 0;
}

/** A blank name is not a save — the location would lose its name. */
export function canSubmitLocationForm(values: LocationFormValues): boolean {
  return textValue(values.name) !== null;
}
