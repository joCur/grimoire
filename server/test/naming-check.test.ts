// The post-run naming check — src/naming-check.ts.
//
// The interesting cases are all about the BOUNDARY, because that is the only
// judgement the check makes: which hits are the same word (and therefore the
// DM's rule) and which are a different word that merely contains the letters.

import { describe, expect, test } from "bun:test";
import {
  checkProposalNaming,
  checkProposalsNaming,
  findRuleHits,
  findWordHits,
  isCasingOnlyRule,
} from "../src/naming-check";

const RULES = [{ from: "Saltport", to: "Salt Harbour" }];

/** A proposed scene as the check reads it: its id, its fields and its body. */
function proposal(
  scene: string,
  fields: Record<string, unknown>,
  body: string,
): { scene: string; fields: Record<string, unknown>; body: string } {
  return { scene, fields, body: `${body}\n` };
}

describe("findWordHits", () => {
  test("finds the term regardless of case", () => {
    expect(findWordHits("On the quay of SALTPORT", "Saltport")).toEqual([15]);
    expect(findWordHits("on the quay of saltport", "SALTPORT")).toEqual([15]);
  });

  test("finds every occurrence, in order", () => {
    expect(findWordHits("Fenn and Fenn", "Fenn")).toEqual([0, 9]);
  });

  test("punctuation and brackets are boundaries", () => {
    expect(findWordHits("(Saltport), he said", "Saltport")).toEqual([1]);
    expect(findWordHits("He came from Saltport.", "Saltport")).toEqual([13]);
  });

  test("an inflected or compounded word is NOT a hit", () => {
    // "Saltporters" and "Saltportquay" are other words; reporting them would
    // mean a hint the DM has to dismiss on every single run.
    expect(findWordHits("The gates of the Saltporters", "Saltport")).toEqual([]);
    expect(findWordHits("on the Saltportquay", "Saltport")).toEqual([]);
    expect(findWordHits("Northsaltport", "Saltport")).toEqual([]);
  });

  test("a needle with its own punctuation keeps that boundary", () => {
    // No word character at the end, so nothing can be glued to it there.
    expect(findWordHits("He lives in St. Mere-Egl.", "St. Mere")).toEqual([12]);
  });

  test("digits count as word characters — a version-like term stays whole", () => {
    expect(findWordHits("Zone 12 is empty", "Zone 1")).toEqual([]);
    expect(findWordHits("Zone 1 is empty", "Zone 1")).toEqual([0]);
  });

  test("an empty or blank needle matches nothing", () => {
    expect(findWordHits("anything", "")).toEqual([]);
    expect(findWordHits("anything", "   ")).toEqual([]);
  });

  test("non-latin scripts get the same boundary rule", () => {
    // Deliberately a name with a diacritic: the boundary is Unicode letters.
    expect(findWordHits("We meet Ödmund today", "Ödmund")).toEqual([8]);
    expect(findWordHits("We meet the Ödmunds today", "Ödmund")).toEqual([]);
  });
});

describe("checkProposalNaming", () => {
  test("no rules means no findings, whatever the proposal says", () => {
    expect(checkProposalNaming(proposal("b", { title: "Saltport" }, "Saltport"), [])).toEqual([]);
  });

  test("a clean proposal produces nothing", () => {
    const hints = checkProposalNaming(
      proposal("quay", { title: "Night watch" }, "The party walks through Salt Harbour."),
      RULES,
    );
    expect(hints).toEqual([]);
  });

  test("a body hit carries the line number and the line", () => {
    const hints = checkProposalNaming(
      proposal("quay", { title: "Night watch" }, "## Flow\n\nThe party reaches Saltport at low tide."),
      RULES,
    );
    expect(hints).toHaveLength(1);
    expect(hints[0]).toEqual({
      from: "Saltport",
      to: "Salt Harbour",
      scene: "quay",
      field: "body",
      line: 3,
      excerpt: "The party reaches Saltport at low tide.",
    });
  });

  test("a field hit names the KEY and carries no line", () => {
    const hints = checkProposalNaming(
      proposal(
        "npcs/brakk",
        { id: "brakk", name: "Brakk", role: "Fisher in Saltport" },
        "## Will\n\nPeace.",
      ),
      RULES,
    );
    expect(hints).toHaveLength(1);
    expect(hints[0]?.field).toBe("role");
    expect(hints[0]?.line).toBeUndefined();
    expect(hints[0]?.excerpt).toBe("Fisher in Saltport");
  });

  test("ids, tags and references are NOT checked — they are addresses", () => {
    const hints = checkProposalNaming(
      proposal(
        "quay",
        {
          id: "saltport",
          title: "Night watch",
          tags: ["saltport"],
          location: "Saltport",
        },
        "## Flow\n\nNothing.",
      ),
      [{ from: "saltport", to: "salt-harbour" }, ...RULES],
    );
    expect(hints).toEqual([]);
  });

  test("one finding per rule per line, not one per occurrence", () => {
    const hints = checkProposalNaming(
      proposal("quay", { title: "Night watch" }, "Saltport and Saltport."),
      RULES,
    );
    expect(hints).toHaveLength(1);
  });

  test("several rules each report separately", () => {
    const hints = checkProposalNaming(
      proposal("quay", { title: "Night watch" }, "Saltport, and Fenn has a new name now."),
      [...RULES, { from: "Fenn", to: "Fennwyn" }],
    );
    expect(hints.map((h) => h.from)).toEqual(["Saltport", "Fenn"]);
  });

  test("a long line is capped and marked as cut", () => {
    const long = `Saltport ${"x".repeat(400)}`;
    const hints = checkProposalNaming(proposal("b", { title: "T" }, long), RULES);
    expect(hints[0]?.excerpt.endsWith("…")).toBe(true);
    expect(hints[0]?.excerpt.length).toBeLessThanOrEqual(161);
  });

  test("fields with nothing readable in them leave the body — no throw", () => {
    // A scene whose fields hold no prose at all (a number, a list, a
    // mapping) is checked on its body alone: the check never throws, it
    // reports what it can read.
    const hints = checkProposalNaming(
      proposal("b", { title: 7, tags: ["x"] }, "Saltport here."),
      RULES,
    );
    expect(hints.map((h) => h.field)).toEqual(["body"]);
  });
});

describe("checkProposalsNaming", () => {
  test("reports per proposal, in proposal order", () => {
    const hints = checkProposalsNaming(
      [
        proposal("a", { title: "A" }, "Nothing here."),
        proposal("b", { title: "Saltport" }, "Saltport."),
      ],
      RULES,
    );
    expect(hints.map((h) => `${h.scene}:${h.field}`)).toEqual([
      "b:title",
      "b:body",
    ]);
  });
});

// --- the false positives the plain search had to learn ---------------------

describe("findRuleHits", () => {
  test("the NEW spelling is not a finding when it CONTAINS the old one", () => {
    // "Dragon" → "Red Dragon" is the shape that broke the check: the model
    // does as it is told, and the old search reported its own target on
    // every single run.
    const rule = { from: "Dragon", to: "Red Dragon" };
    expect(findRuleHits("A Red Dragon guards the pass.", rule)).toEqual([]);
    // A bare "Dragon" is still exactly what the rule is about.
    expect(findRuleHits("A Dragon guards the pass.", rule)).toEqual([2]);
    // And both in one line: only the bare one is reported.
    expect(findRuleHits("The Red Dragon and a Dragon", rule)).toEqual([21]);
  });

  test("the containment rule works on either side of the new spelling", () => {
    expect(findRuleHits("The Great Hall of Dragons", { from: "Hall", to: "Great Hall of Dragons" }))
      .toEqual([]);
    expect(findRuleHits("In the Hall", { from: "Hall", to: "Great Hall of Dragons" })).toEqual([7]);
  });

  test("a CASING-only rule flags the wrong casing and not its own target", () => {
    const rule = { from: "saltport", to: "Saltport" };
    expect(isCasingOnlyRule(rule)).toBe(true);
    // The correct spelling is silent …
    expect(findRuleHits("The party reaches Saltport.", rule)).toEqual([]);
    // … and the wrong one is not.
    expect(findRuleHits("The party reaches saltport.", rule)).toEqual([18]);
    // Still word boundaries: an inflection is a different word.
    expect(findRuleHits("The gates of the saltporters", rule)).toEqual([]);
  });

  test("an ordinary rule stays case-INSENSITIVE", () => {
    expect(isCasingOnlyRule({ from: "Saltport", to: "Salt Harbour" })).toBe(false);
    expect(findRuleHits("on the quay of SALTPORT", { from: "Saltport", to: "Salt Harbour" }))
      .toEqual([15]);
  });

  test("a half-written rule: no `to` means nothing to protect, no `from` means nothing to find", () => {
    expect(findRuleHits("A Dragon here", { from: "Dragon", to: "" })).toEqual([2]);
    expect(findRuleHits("A Dragon here", { from: "", to: "Red Dragon" })).toEqual([]);
  });
});

describe("checkProposalNaming — the refined rules end to end", () => {
  test("a proposal that applied the Dragon rule produces NO hint", () => {
    const hints = checkProposalNaming(
      proposal("quay", { title: "The Red Dragon" }, "## Flow\n\nThe Red Dragon sleeps."),
      [{ from: "Dragon", to: "Red Dragon" }],
    );
    expect(hints).toEqual([]);
  });

  test("a proposal that did NOT apply it is flagged, title and body", () => {
    const hints = checkProposalNaming(
      proposal("quay", { title: "The Dragon" }, "## Flow\n\nThe Dragon sleeps."),
      [{ from: "Dragon", to: "Red Dragon" }],
    );
    expect(hints.map((h) => h.field)).toEqual(["title", "body"]);
  });

  test("a casing rule flags only the lower-case line", () => {
    const hints = checkProposalNaming(
      proposal("quay", { title: "Night watch" }, "Saltport holds a market.\nSo does saltport."),
      [{ from: "saltport", to: "Saltport" }],
    );
    expect(hints).toHaveLength(1);
    expect(hints[0]?.excerpt).toBe("So does saltport.");
  });
});
