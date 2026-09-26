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
  const terms = [term("k", "keeper", "Warden"), term("a", "Abyss", "Chasm"), term("m", "mire", "Bog")];

  test("alphabetical by term, whatever the order of creation", () => {
    expect(visibleGlossaryTerms(terms).map((t) => t.id)).toEqual(["a", "k", "m"]);
  });

  test("the filter reads term AND explanation, case-insensitively", () => {
    expect(visibleGlossaryTerms(terms, "KEEP").map((t) => t.id)).toEqual(["k"]);
    expect(visibleGlossaryTerms(terms, "bog").map((t) => t.id)).toEqual(["m"]);
    expect(visibleGlossaryTerms(terms, "  ")).toHaveLength(3);
    expect(visibleGlossaryTerms(terms, "zzz")).toEqual([]);
  });
});

describe("what a save writes", () => {
  test("a term needs its wording; the explanation may be empty", () => {
    expect(isSendableGlossaryTerm({ term: "keeper", explanation: "" })).toBe(true);
    expect(isSendableGlossaryTerm({ term: "  ", explanation: "Warden" })).toBe(false);
    expect(isSendableGlossaryTerm(emptyGlossaryTermDraft())).toBe(false);
  });

  test("only the fields that moved are written", () => {
    const original = { term: "keeper", explanation: "Warden" };
    expect(glossaryTermChange(original, { ...original, explanation: "Wardress" })).toEqual({
      explanation: "Wardress",
    });
    expect(glossaryTermChange(original, original)).toEqual({});
  });
});
