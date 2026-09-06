// The `[[slug]]` grammar (issue #68): what is a reference, what is text.

import { describe, expect, test } from "bun:test";
import {
  bodyReferencesEntity,
  entityRefSlugs,
  entityRefSource,
  expandBodyEntityRefs,
  expandEntityRefs,
  isEntityRefSlug,
  rewriteBodyEntityRefs,
  splitCodeSegments,
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
    expect(expandBodyEntityRefs(text, nameOf)).toContain("Hafenmeisterin Jorna");
  });

  test("expansion skips fenced blocks and code spans", () => {
    const expanded = expandBodyEntityRefs(FENCED, nameOf);
    expect(expanded).toContain("Vorher Hafenmeisterin Jorna.");
    expect(expanded).toContain("[[jorna]] im Block");
    expect(expanded).toContain("`[[jorna]]` inline");
  });

  test("a rename rewrites prose only — code stays byte-identical", () => {
    const rewritten = rewriteBodyEntityRefs(FENCED, "jorna", "jorna-salzhand");
    expect(rewritten).toContain("Vorher [[jorna-salzhand]].");
    expect(rewritten).toContain("[[jorna]] im Block");
    expect(rewritten).toContain("`[[jorna]]` inline");
    // Other references are untouched, brackets and all.
    expect(rewriteBodyEntityRefs("[[bucht]]", "jorna", "j2")).toBe("[[bucht]]");
  });

  test("a mention only inside code is not a reference", () => {
    expect(bodyReferencesEntity("nur `[[jorna]]` hier", "jorna")).toBe(false);
    expect(bodyReferencesEntity("```\n[[jorna]]\n```\n", "jorna")).toBe(false);
    expect(bodyReferencesEntity("Am Kai wartet [[jorna]]s Boot.", "jorna")).toBe(true);
    expect(bodyReferencesEntity("Nur Prosa.", "jorna")).toBe(false);
  });
});

test("slug predicate and source spelling", () => {
  expect(isEntityRefSlug("alte-mole")).toBe(true);
  expect(isEntityRefSlug("Alte Mole")).toBe(false);
  expect(entityRefSource("jorna")).toBe("[[jorna]]");
});
