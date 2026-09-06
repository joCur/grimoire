// The `[[slug]]` grammar (issue #68): what is a reference, what is text.

import { describe, expect, test } from "bun:test";
import {
  entityRefSlugs,
  entityRefSource,
  expandEntityRefs,
  isEntityRefSlug,
  splitEntityRefs,
} from "../src/refs";

const NAMES: Record<string, string> = { jorna: "Hafenmeisterin Jorna", bucht: "Die Bucht" };
const nameOf = (slug: string): string | undefined => NAMES[slug];

describe("splitEntityRefs", () => {
  test("text without a reference stays one piece", () => {
    expect(splitEntityRefs("Nur Prosa [ein Link](x)")).toEqual([
      { type: "text", value: "Nur Prosa [ein Link](x)" },
    ]);
  });

  test("splits around a reference and keeps the suffix", () => {
    expect(splitEntityRefs("Am Kai wartet [[jorna]]s Boot.")).toEqual([
      { type: "text", value: "Am Kai wartet " },
      { type: "ref", slug: "jorna" },
      { type: "text", value: "s Boot." },
    ]);
  });

  test("several references in one text", () => {
    expect(entityRefSlugs("[[jorna]] und [[fenn]] und wieder [[jorna]]")).toEqual([
      "jorna",
      "fenn",
    ]);
  });

  test("only kebab-case slugs count — everything else is plain text", () => {
    for (const text of ["[[Jorna]]", "[[jorna ]]", "[[a b]]", "[[]]", "[[jorna|Jorna]]", "[jorna]"]) {
      expect(splitEntityRefs(text)).toEqual([{ type: "text", value: text }]);
    }
    expect(entityRefSlugs("[[alte-mole]]")).toEqual(["alte-mole"]);
  });
});

describe("expandEntityRefs", () => {
  test("resolved references become the current display name", () => {
    expect(expandEntityRefs("[[jorna]] steht an [[bucht]].", nameOf)).toBe(
      "Hafenmeisterin Jorna steht an Die Bucht.",
    );
  });

  test("unresolved reference keeps its brackets (degrades, never throws)", () => {
    expect(expandEntityRefs("Wer ist [[niemand]]?", nameOf)).toBe("Wer ist [[niemand]]?");
  });

  test("an empty display name counts as unresolved", () => {
    expect(expandEntityRefs("[[leer]]", () => "")).toBe("[[leer]]");
  });
});

test("slug predicate and source spelling", () => {
  expect(isEntityRefSlug("alte-mole")).toBe(true);
  expect(isEntityRefSlug("Alte Mole")).toBe(false);
  expect(entityRefSource("jorna")).toBe("[[jorna]]");
});
