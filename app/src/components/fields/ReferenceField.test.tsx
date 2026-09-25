// Render tests of the reference building block (react-dom/server — no DOM):
// the known name of an id, and the note under the input.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ReferenceNote, referenceLabel } from "./ReferenceField";

const options = [
  { value: "fenn", label: "Fenn" },
  { value: "jorna", label: "Hafenmeisterin Jorna" },
  { value: "namenlos", label: "namenlos" },
];

describe("referenceLabel", () => {
  test("names a known id and stays quiet otherwise", () => {
    expect(referenceLabel(options, "jorna")).toBe("Hafenmeisterin Jorna");
    expect(referenceLabel(options, "kapitaen-torv")).toBe(undefined);
    // A label equal to the id is no name.
    expect(referenceLabel(options, "namenlos")).toBe(undefined);
  });
});

describe("ReferenceNote", () => {
  const note = (value: string) =>
    renderToStaticMarkup(<ReferenceNote options={options} value={value} unknown="unbekannt" />);

  test("the name of a known id, nothing for a nameless one or an empty field", () => {
    expect(note("jorna")).toContain("Hafenmeisterin Jorna");
    expect(note("namenlos")).toBe("");
    expect(note("  ")).toBe("");
  });

  test("an id no option has says what the caller calls unknown", () => {
    expect(note("kapitaen-torv")).toContain("unbekannt");
  });
});
