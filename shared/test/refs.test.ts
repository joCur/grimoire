// The `[[slug]]` grammar: what is a reference, what is text.

import { describe, expect, test } from "bun:test";
import {
  bodyRefSlugs,
  bodyReferencesSlug,
  refSlugs,
  refSource,
  expandBodyRefs,
  expandRefs,
  isRefSlug,
  splitCodeSegments,
  splitRefs,
} from "../src/refs";

const NAMES: Record<string, string> = { jorna: "Hafenmeisterin Jorna", bucht: "Die Bucht" };
const nameOf = (slug: string): string | undefined => NAMES[slug];

describe("splitRefs", () => {
  test("text without a reference stays one piece", () => {
    expect(splitRefs("Nur Prosa [ein Link](x)")).toEqual([
      { type: "text", value: "Nur Prosa [ein Link](x)" },
    ]);
  });

  test("splits around a reference and keeps the suffix", () => {
    expect(splitRefs("Am Kai wartet [[jorna]]s Boot.")).toEqual([
      { type: "text", value: "Am Kai wartet " },
      { type: "ref", slug: "jorna" },
      { type: "text", value: "s Boot." },
    ]);
  });

  test("several references in one text", () => {
    expect(refSlugs("[[jorna]] und [[fenn]] und wieder [[jorna]]")).toEqual([
      "jorna",
      "fenn",
    ]);
  });

  test("only kebab-case slugs count — everything else is plain text", () => {
    for (const text of ["[[Jorna]]", "[[jorna ]]", "[[a b]]", "[[]]", "[[jorna|Jorna]]", "[jorna]"]) {
      expect(splitRefs(text)).toEqual([{ type: "text", value: text }]);
    }
    expect(refSlugs("[[alte-mole]]")).toEqual(["alte-mole"]);
  });
});

describe("expandRefs", () => {
  test("resolved references become the current display name", () => {
    expect(expandRefs("[[jorna]] steht an [[bucht]].", nameOf)).toBe(
      "Hafenmeisterin Jorna steht an Die Bucht.",
    );
  });

  test("unresolved reference keeps its brackets (degrades, never throws)", () => {
    expect(expandRefs("Wer ist [[niemand]]?", nameOf)).toBe("Wer ist [[niemand]]?");
  });

  test("an empty display name counts as unresolved", () => {
    expect(expandRefs("[[leer]]", () => "")).toBe("[[leer]]");
  });
});

describe("code regions are not prose", () => {
  const FENCED = [
    "Vorher [[jorna]].",
    "",
    "```md",
    "[[jorna]] im Block",
    "```",
    "",
    "Nachher `[[jorna]]` inline.",
    "",
  ].join("\n");

  test("segments concatenate back to the input, byte for byte", () => {
    for (const text of [FENCED, "", "`x`", "``` \n a \n", "~~~\n[[jorna]]\n~~~\n", "a ` b"]) {
      expect(
        splitCodeSegments(text)
          .map((segment) => segment.value)
          .join(""),
      ).toBe(text);
    }
  });

  test("a code span does not reach across a blank line", () => {
    const text = "ein ` Backtick\n\nund [[jorna]] ` noch einer";
    expect(splitCodeSegments(text).every((segment) => !segment.code)).toBe(true);
    expect(expandBodyRefs(text, nameOf)).toContain("Hafenmeisterin Jorna");
  });

  test("expansion skips fenced blocks and code spans", () => {
    const expanded = expandBodyRefs(FENCED, nameOf);
    expect(expanded).toContain("Vorher Hafenmeisterin Jorna.");
    expect(expanded).toContain("[[jorna]] im Block");
    expect(expanded).toContain("`[[jorna]]` inline");
  });

  test("a mention only inside code is not a reference", () => {
    expect(bodyReferencesSlug("nur `[[jorna]]` hier", "jorna")).toBe(false);
    expect(bodyReferencesSlug("```\n[[jorna]]\n```\n", "jorna")).toBe(false);
    expect(bodyReferencesSlug("Am Kai wartet [[jorna]]s Boot.", "jorna")).toBe(true);
    expect(bodyReferencesSlug("Nur Prosa.", "jorna")).toBe(false);
  });

  test("the slugs of a body are its prose references, once each", () => {
    expect(bodyRefSlugs(FENCED)).toEqual(["jorna"]);
    expect(bodyRefSlugs("nur `[[fenn]]` und\n```\n[[bucht]]\n```\n")).toEqual([]);
    expect(bodyRefSlugs("[[fenn]] trifft [[jorna]], dann [[fenn]]s Boot.")).toEqual([
      "fenn",
      "jorna",
    ]);
    expect(bodyRefSlugs("Nur Prosa, [[Jorna]] ist Text.")).toEqual([]);
  });
});

test("slug predicate and source spelling", () => {
  expect(isRefSlug("alte-mole")).toBe(true);
  expect(isRefSlug("Alte Mole")).toBe(false);
  expect(refSource("jorna")).toBe("[[jorna]]");
});
