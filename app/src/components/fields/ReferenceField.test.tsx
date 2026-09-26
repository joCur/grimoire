// Render tests of the reference building block (react-dom/server — no DOM):
// the known name of an id, and the note under the input.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ReferenceNote, referenceLabel } from "./ReferenceField";

const options = [
  { value: "fenn", label: "Fenn" },
  { value: "jorna", label: "Harbourmaster Jorna" },
  { value: "nameless", label: "nameless" },
];

describe("referenceLabel", () => {
  test("names a known id and stays quiet otherwise", () => {
    expect(referenceLabel(options, "jorna")).toBe("Harbourmaster Jorna");
    expect(referenceLabel(options, "captain-torv")).toBe(undefined);
    // A label equal to the id is no name.
    expect(referenceLabel(options, "nameless")).toBe(undefined);
  });
});

describe("ReferenceNote", () => {
  const note = (value: string) =>
    renderToStaticMarkup(<ReferenceNote options={options} value={value} unknown="unknown" />);

  test("the name of a known id, nothing for a nameless one or an empty field", () => {
    expect(note("jorna")).toContain("Harbourmaster Jorna");
    expect(note("nameless")).toBe("");
    expect(note("  ")).toBe("");
  });

  test("an id no option has says what the caller calls unknown", () => {
    expect(note("captain-torv")).toContain("unknown");
  });
});
