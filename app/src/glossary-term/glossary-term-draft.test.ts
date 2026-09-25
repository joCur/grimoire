// The glossary page's rules for a term, without a DOM.

import { describe, expect, test } from "bun:test";
import type { GlossaryTerm } from "@grimoire/shared/glossary-term";

import {
  emptyGlossaryTermDraft,
  glossaryTermChange,
  isSendableGlossaryTerm,
  visibleGlossaryTerms,
} from "./glossary-term-draft";

const term = (id: string, text: string, explanation = ""): GlossaryTerm => ({
  id,
  term: text,
  explanation,
  rev: 1,
});

describe("visibleGlossaryTerms", () => {
  const terms = [term("k", "keeper", "Wärter"), term("a", "Abyss", "Abgrund"), term("m", "mire", "Moor")];

  test("alphabetical by term, whatever the order of creation", () => {
    expect(visibleGlossaryTerms(terms).map((t) => t.id)).toEqual(["a", "k", "m"]);
  });

  test("the filter reads term AND explanation, case-insensitively", () => {
    expect(visibleGlossaryTerms(terms, "KEEP").map((t) => t.id)).toEqual(["k"]);
    expect(visibleGlossaryTerms(terms, "moor").map((t) => t.id)).toEqual(["m"]);
    expect(visibleGlossaryTerms(terms, "  ")).toHaveLength(3);
    expect(visibleGlossaryTerms(terms, "zzz")).toEqual([]);
  });
});

describe("what a save writes", () => {
  test("a term needs its wording; the explanation may be empty", () => {
    expect(isSendableGlossaryTerm({ term: "keeper", explanation: "" })).toBe(true);
    expect(isSendableGlossaryTerm({ term: "  ", explanation: "Wärter" })).toBe(false);
    expect(isSendableGlossaryTerm(emptyGlossaryTermDraft())).toBe(false);
  });

  test("only the fields that moved are written", () => {
    const original = { term: "keeper", explanation: "Wärter" };
    expect(glossaryTermChange(original, { ...original, explanation: "Wärterin" })).toEqual({
      explanation: "Wärterin",
    });
    expect(glossaryTermChange(original, original)).toEqual({});
  });
});
