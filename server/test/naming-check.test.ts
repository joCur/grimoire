// The post-run naming check — src/naming-check.ts.
//
// The interesting cases are all about the BOUNDARY, because that is the only
// judgement the check makes: which hits are the same word (and therefore the
// DM's rule) and which are a different word that merely contains the letters.

import { describe, expect, test } from "bun:test";
import {
  checkDraftNaming,
  checkDraftsNaming,
  findRuleHits,
  findWordHits,
  isCasingOnlyRule,
} from "../src/naming-check";

const RULES = [{ from: "Salt Harbour", to: "Salzhafen" }];

/** A proposed scene as the check reads it: its id, its fields and its body. */
function draft(
  scene: string,
  fields: Record<string, unknown>,
  body: string,
): { scene: string; fields: Record<string, unknown>; body: string } {
  return { scene, fields, body: `${body}\n` };
}

describe("findWordHits", () => {
  test("finds the term regardless of case", () => {
    expect(findWordHits("Am Kai von SALT HARBOUR", "Salt Harbour")).toEqual([11]);
    expect(findWordHits("am kai von salt harbour", "SALT HARBOUR")).toEqual([11]);
  });

  test("finds every occurrence, in order", () => {
    expect(findWordHits("Fenn und Fenn", "Fenn")).toEqual([0, 9]);
  });

  test("punctuation and brackets are boundaries", () => {
    expect(findWordHits("(Salzhafen), sagte er", "Salzhafen")).toEqual([1]);
    expect(findWordHits("Er kam aus Salzhafen.", "Salzhafen")).toEqual([11]);
  });

  test("an inflected or compounded word is NOT a hit", () => {
    // „Salzhafens" and „Salzhafenkai" are other words; reporting them would
    // mean a hint the DM has to dismiss on every single run.
    expect(findWordHits("Die Tore Salzhafens", "Salzhafen")).toEqual([]);
    expect(findWordHits("am Salzhafenkai", "Salzhafen")).toEqual([]);
    expect(findWordHits("Nordsalzhafen", "Salzhafen")).toEqual([]);
  });

  test("a needle with its own punctuation keeps that boundary", () => {
    // No word character at the end, so nothing can be glued to it there.
    expect(findWordHits("Er wohnt in St. Mere-Egl.", "St. Mere")).toEqual([12]);
  });

  test("digits count as word characters — a version-like term stays whole", () => {
    expect(findWordHits("Zone 12 ist leer", "Zone 1")).toEqual([]);
    expect(findWordHits("Zone 1 ist leer", "Zone 1")).toEqual([0]);
  });

  test("an empty or blank needle matches nothing", () => {
    expect(findWordHits("irgendwas", "")).toEqual([]);
    expect(findWordHits("irgendwas", "   ")).toEqual([]);
  });

  test("non-latin scripts get the same boundary rule", () => {
    expect(findWordHits("Wir treffen Ödmund heute", "Ödmund")).toEqual([12]);
    expect(findWordHits("Wir treffen Ödmunds Boot", "Ödmund")).toEqual([]);
  });
});

describe("checkDraftNaming", () => {
  test("no rules means no findings, whatever the draft says", () => {
    expect(checkDraftNaming(draft("b", { title: "Salt Harbour" }, "Salt Harbour"), [])).toEqual(
      [],
    );
  });

  test("a clean draft produces nothing", () => {
    const hints = checkDraftNaming(
      draft("kai", { title: "Nachtwache" }, "Die Gruppe geht durch Salzhafen."),
      RULES,
    );
    expect(hints).toEqual([]);
  });

  test("a body hit carries the line number and the line", () => {
    const hints = checkDraftNaming(
      draft(
        "kai",
        { title: "Nachtwache" },
        "## Flow\n\nDie Gruppe erreicht Salt Harbour bei Ebbe.",
      ),
      RULES,
    );
    expect(hints).toHaveLength(1);
    expect(hints[0]).toEqual({
      from: "Salt Harbour",
      to: "Salzhafen",
      scene: "kai",
      field: "body",
      line: 3,
      excerpt: "Die Gruppe erreicht Salt Harbour bei Ebbe.",
    });
  });

  test("a field hit names the KEY and carries no line", () => {
    const hints = checkDraftNaming(
      draft(
        "npcs/brakk",
        { id: "brakk", name: "Brakk", role: "Fischer in Salt Harbour" },
        "## Will\n\nRuhe.",
      ),
      RULES,
    );
    expect(hints).toHaveLength(1);
    expect(hints[0]?.field).toBe("role");
    expect(hints[0]?.line).toBeUndefined();
    expect(hints[0]?.excerpt).toBe("Fischer in Salt Harbour");
  });

  test("ids, tags and references are NOT checked — they are addresses", () => {
    const hints = checkDraftNaming(
      draft(
        "kai",
        {
          id: "salt-harbour",
          title: "Nachtwache",
          tags: ["salt harbour"],
          location: "Salt Harbour",
        },
        "## Flow\n\nNichts.",
      ),
      [{ from: "salt-harbour", to: "salzhafen" }, ...RULES],
    );
    expect(hints).toEqual([]);
  });

  test("one finding per rule per line, not one per occurrence", () => {
    const hints = checkDraftNaming(
      draft("kai", { title: "Nachtwache" }, "Salt Harbour und Salt Harbour."),
      RULES,
    );
    expect(hints).toHaveLength(1);
  });

  test("several rules each report separately", () => {
    const hints = checkDraftNaming(
      draft(
        "kai",
        { title: "Nachtwache" },
        "Salt Harbour, und Fenn heißt jetzt anders.",
      ),
      [...RULES, { from: "Fenn", to: "Fennwyn" }],
    );
    expect(hints.map((h) => h.from)).toEqual(["Salt Harbour", "Fenn"]);
  });

  test("a long line is capped and marked as cut", () => {
    const long = `Salt Harbour ${"x".repeat(400)}`;
    const hints = checkDraftNaming(draft("b", { title: "T" }, long), RULES);
    expect(hints[0]?.excerpt.endsWith("…")).toBe(true);
    expect(hints[0]?.excerpt.length).toBeLessThanOrEqual(161);
  });

  test("fields with nothing readable in them leave the body — no throw", () => {
    // A scene whose fields hold no prose at all (a number, a list, a
    // mapping) is checked on its body alone: the check never throws, it
    // reports what it can read.
    const hints = checkDraftNaming(
      draft("b", { title: 7, tags: ["x"] }, "Salt Harbour hier."),
      RULES,
    );
    expect(hints.map((h) => h.field)).toEqual(["body"]);
  });
});

describe("checkDraftsNaming", () => {
  test("reports per draft, in draft order", () => {
    const hints = checkDraftsNaming(
      [
        draft("a", { title: "A" }, "Nichts hier."),
        draft("b", { title: "Salt Harbour" }, "Salt Harbour."),
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
    // „Dragon" → „Red Dragon" is the shape that broke the check: the model
    // does as it is told, and the old search reported its own target on
    // every single run.
    const rule = { from: "Dragon", to: "Red Dragon" };
    expect(findRuleHits("Ein Red Dragon bewacht den Pass.", rule)).toEqual([]);
    // A bare „Dragon" is still exactly what the rule is about.
    expect(findRuleHits("Ein Dragon bewacht den Pass.", rule)).toEqual([4]);
    // And both in one line: only the bare one is reported.
    expect(findRuleHits("Der Red Dragon und ein Dragon", rule)).toEqual([23]);
  });

  test("the containment rule works on either side of the new spelling", () => {
    expect(findRuleHits("Die Halle der Drachen Nord", { from: "Halle", to: "Halle der Drachen" }))
      .toEqual([]);
    expect(findRuleHits("In der Halle", { from: "Halle", to: "Halle der Drachen" })).toEqual([7]);
  });

  test("a CASING-only rule flags the wrong casing and not its own target", () => {
    const rule = { from: "salzhafen", to: "Salzhafen" };
    expect(isCasingOnlyRule(rule)).toBe(true);
    // The correct spelling is silent …
    expect(findRuleHits("Die Gruppe erreicht Salzhafen.", rule)).toEqual([]);
    // … and the wrong one is not.
    expect(findRuleHits("Die Gruppe erreicht salzhafen.", rule)).toEqual([20]);
    // Still word boundaries: an inflection is a different word.
    expect(findRuleHits("Die Tore salzhafens", rule)).toEqual([]);
  });

  test("an ordinary rule stays case-INSENSITIVE", () => {
    expect(isCasingOnlyRule({ from: "Salt Harbour", to: "Salzhafen" })).toBe(false);
    expect(findRuleHits("am kai von SALT HARBOUR", { from: "Salt Harbour", to: "Salzhafen" }))
      .toEqual([11]);
  });

  test("a half-written rule: no `to` means nothing to protect, no `from` means nothing to find", () => {
    expect(findRuleHits("Ein Dragon hier", { from: "Dragon", to: "" })).toEqual([4]);
    expect(findRuleHits("Ein Dragon hier", { from: "", to: "Red Dragon" })).toEqual([]);
  });
});

describe("checkDraftNaming — the refined rules end to end", () => {
  test("a draft that applied the Dragon rule produces NO hint", () => {
    const hints = checkDraftNaming(
      draft("kai", { title: "Der Red Dragon" }, "## Flow\n\nDer Red Dragon schläft."),
      [{ from: "Dragon", to: "Red Dragon" }],
    );
    expect(hints).toEqual([]);
  });

  test("a draft that did NOT apply it is flagged, title and body", () => {
    const hints = checkDraftNaming(
      draft("kai", { title: "Der Dragon" }, "## Flow\n\nDer Dragon schläft."),
      [{ from: "Dragon", to: "Red Dragon" }],
    );
    expect(hints.map((h) => h.field)).toEqual(["title", "body"]);
  });

  test("a casing rule flags only the lower-case line", () => {
    const hints = checkDraftNaming(
      draft(
        "kai",
        { title: "Nachtwache" },
        "In Salzhafen ist Markt.\nIn salzhafen auch.",
      ),
      [{ from: "salzhafen", to: "Salzhafen" }],
    );
    expect(hints).toHaveLength(1);
    expect(hints[0]?.excerpt).toBe("In salzhafen auch.");
  });
});
