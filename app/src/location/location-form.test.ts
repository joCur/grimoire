// The rules of the location's form: what it starts with, the write that
// decides what is sent at all, and the representation a cleared field is
// written in. All pure — the write itself is the location's editing session
// (./use-location-edit.ts).

import type { LocationProposal } from "@grimoire/shared/location";
import { describe, expect, test } from "bun:test";

import {
  canSubmitLocationForm,
  locationFormChange,
  locationFormDirty,
  locationFormValues,
  type LocationFormValues,
} from "./location-form";

const LEUCHTTURM: LocationProposal = {
  id: "leuchtturm",
  name: "Der Leuchtturm",
  chapter: "01-salzhafen",
  roll20Page: "Leuchtturm",
  body: "",
};

const initial = locationFormValues(LEUCHTTURM);

const edited = (changes: Partial<LocationFormValues>): LocationFormValues => ({
  ...initial,
  ...changes,
});

describe("locationFormValues", () => {
  test("the location's values, a field it does not hold as an empty field", () => {
    expect(initial).toEqual({
      name: "Der Leuchtturm",
      chapter: "01-salzhafen",
      roll20Page: "Leuchtturm",
      atmosphere: "",
    });
  });
});

describe("locationFormChange", () => {
  test("an untouched form writes nothing, whitespace is no change", () => {
    expect(locationFormChange(initial, initial)).toEqual({});
    expect(locationFormChange(initial, edited({ roll20Page: " Leuchtturm " }))).toEqual({});
    expect(locationFormDirty(initial, initial)).toBe(false);
  });

  test("only the changed field is sent", () => {
    expect(locationFormChange(initial, edited({ atmosphere: "Salz in der Luft." }))).toEqual({
      atmosphere: "Salz in der Luft.",
    });
  });

  test("a location may sit outside every chapter — clearing it clears the value", () => {
    expect(locationFormChange(initial, edited({ chapter: "  " }))).toEqual({ chapter: null });
  });

  test("a blank name is never written, blocks the save and is still work", () => {
    const blank = edited({ name: "" });
    expect(locationFormChange(initial, blank)).toEqual({});
    expect(canSubmitLocationForm(blank)).toBe(false);
    expect(canSubmitLocationForm(initial)).toBe(true);
    expect(locationFormDirty(initial, blank)).toBe(true);
  });
});
