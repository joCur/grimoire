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

const NAMES: Record<string, string> = { jorna: "Harbourmaster Jorna", cove: "The Cove" };
const nameOf = (slug: string): string | undefined => NAMES[slug];

describe("splitRefs", () => {
  test("text without a reference stays one piece", () => {
    expect(splitRefs("Just prose [a link](x)")).toEqual([
      { type: "text", value: "Just prose [a link](x)" },
    ]);
  });

  test("splits around a reference and keeps the suffix", () => {
    expect(splitRefs("At the quay waits [[jorna]]s boat.")).toEqual([
      { type: "text", value: "At the quay waits " },
      { type: "ref", slug: "jorna" },
      { type: "text", value: "s boat." },
    ]);
  });

  test("several references in one text", () => {
    expect(refSlugs("[[jorna]] and [[fenn]] and again [[jorna]]")).toEqual([
      "jorna",
      "fenn",
    ]);
  });

  test("only kebab-case slugs count — everything else is plain text", () => {
    for (const text of ["[[Jorna]]", "[[jorna ]]", "[[a b]]", "[[]]", "[[jorna|Jorna]]", "[jorna]"]) {
      expect(splitRefs(text)).toEqual([{ type: "text", value: text }]);
    }
    expect(refSlugs("[[old-mole]]")).toEqual(["old-mole"]);
  });
});

describe("expandRefs", () => {
  test("resolved references become the current display name", () => {
    expect(expandRefs("[[jorna]] stands at [[cove]].", nameOf)).toBe(
      "Harbourmaster Jorna stands at The Cove.",
    );
  });

  test("unresolved reference keeps its brackets (degrades, never throws)", () => {
    expect(expandRefs("Who is [[nobody]]?", nameOf)).toBe("Who is [[nobody]]?");
  });

  test("an empty display name counts as unresolved", () => {
    expect(expandRefs("[[empty]]", () => "")).toBe("[[empty]]");
  });
});

describe("code regions are not prose", () => {
  const FENCED = [
    "Before [[jorna]].",
    "",
    "```md",
    "[[jorna]] in the block",
    "```",
    "",
    "After `[[jorna]]` inline.",
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
    const text = "one ` backtick\n\nand [[jorna]] ` another one";
    expect(splitCodeSegments(text).every((segment) => !segment.code)).toBe(true);
    expect(expandBodyRefs(text, nameOf)).toContain("Harbourmaster Jorna");
  });

  test("expansion skips fenced blocks and code spans", () => {
    const expanded = expandBodyRefs(FENCED, nameOf);
    expect(expanded).toContain("Before Harbourmaster Jorna.");
    expect(expanded).toContain("[[jorna]] in the block");
    expect(expanded).toContain("`[[jorna]]` inline");
  });

  test("a mention only inside code is not a reference", () => {
    expect(bodyReferencesSlug("only `[[jorna]]` here", "jorna")).toBe(false);
    expect(bodyReferencesSlug("```\n[[jorna]]\n```\n", "jorna")).toBe(false);
    expect(bodyReferencesSlug("At the quay waits [[jorna]]s boat.", "jorna")).toBe(true);
    expect(bodyReferencesSlug("Just prose.", "jorna")).toBe(false);
  });

  test("the slugs of a body are its prose references, once each", () => {
    expect(bodyRefSlugs(FENCED)).toEqual(["jorna"]);
    expect(bodyRefSlugs("only `[[fenn]]` and\n```\n[[cove]]\n```\n")).toEqual([]);
    expect(bodyRefSlugs("[[fenn]] meets [[jorna]], then [[fenn]]s boat.")).toEqual([
      "fenn",
      "jorna",
    ]);
    expect(bodyRefSlugs("Just prose, [[Jorna]] is text.")).toEqual([]);
  });
});

test("slug predicate and source spelling", () => {
  expect(isRefSlug("old-mole")).toBe(true);
  expect(isRefSlug("Old Mole")).toBe(false);
  expect(refSource("jorna")).toBe("[[jorna]]");
});
