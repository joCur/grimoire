// The post-run naming check (issue #53 AK3) — src/naming-check.ts.
//
// The interesting cases are all about the BOUNDARY, because that is the only
// judgement the check makes: which hits are the same word (and therefore the
// DM's rule) and which are a different word that merely contains the letters.

import { describe, expect, test } from "bun:test";
import { checkDraftNaming, checkDraftsNaming, findWordHits } from "../src/naming-check";

const RULES = [{ from: "Salt Harbour", to: "Salzhafen" }];

function draft(properties: string, body: string): string {
  return `---\n${properties}\n---\n\n${body}\n`;
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
    expect(checkDraftNaming("a/b", draft("title: Salt Harbour", "Salt Harbour"), [])).toEqual([]);
  });

  test("a clean draft produces nothing", () => {
    const hints = checkDraftNaming(
      "01-salzhafen/kai",
      draft("title: Nachtwache", "Die Gruppe geht durch Salzhafen."),
      RULES,
    );
    expect(hints).toEqual([]);
  });

  test("a body hit carries the line number and the line", () => {
    const hints = checkDraftNaming(
      "01-salzhafen/kai",
      draft("title: Nachtwache", "## Flow\n\nDie Gruppe erreicht Salt Harbour bei Ebbe."),
      RULES,
    );
    expect(hints).toHaveLength(1);
    expect(hints[0]).toEqual({
      from: "Salt Harbour",
      to: "Salzhafen",
      path: "01-salzhafen/kai",
      field: "body",
      // The parsed body starts with the blank line after the properties block.
      line: 4,
      excerpt: "Die Gruppe erreicht Salt Harbour bei Ebbe.",
    });
  });

  test("a properties hit names the KEY and carries no line", () => {
    const hints = checkDraftNaming(
      "npcs/brakk",
      draft("id: brakk\nname: Brakk\nrole: Fischer in Salt Harbour", "## Will\n\nRuhe."),
      RULES,
    );
    expect(hints).toHaveLength(1);
    expect(hints[0]?.field).toBe("role");
    expect(hints[0]?.line).toBeUndefined();
    expect(hints[0]?.excerpt).toBe("Fischer in Salt Harbour");
  });

  test("ids, tags and references are NOT checked — they are addresses", () => {
    const hints = checkDraftNaming(
      "01-salzhafen/kai",
      draft(
        "id: salt-harbour\ntitle: Nachtwache\ntags: [salt harbour]\nlocation: Salt Harbour",
        "## Flow\n\nNichts.",
      ),
      [{ from: "salt-harbour", to: "salzhafen" }, ...RULES],
    );
    expect(hints).toEqual([]);
  });

  test("one finding per rule per line, not one per occurrence", () => {
    const hints = checkDraftNaming(
      "01-salzhafen/kai",
      draft("title: Nachtwache", "Salt Harbour und Salt Harbour."),
      RULES,
    );
    expect(hints).toHaveLength(1);
  });

  test("several rules each report separately", () => {
    const hints = checkDraftNaming(
      "01-salzhafen/kai",
      draft("title: Nachtwache", "Salt Harbour, und Fenn heißt jetzt anders."),
      [...RULES, { from: "Fenn", to: "Fennwyn" }],
    );
    expect(hints.map((h) => h.from)).toEqual(["Salt Harbour", "Fenn"]);
  });

  test("a long line is capped and marked as cut", () => {
    const long = `Salt Harbour ${"x".repeat(400)}`;
    const hints = checkDraftNaming("a/b", draft("title: T", long), RULES);
    expect(hints[0]?.excerpt.endsWith("…")).toBe(true);
    expect(hints[0]?.excerpt.length).toBeLessThanOrEqual(161);
  });

  test("an unparseable properties block degrades to body-only — no throw", () => {
    const hints = checkDraftNaming("a/b", "---\n: : :\n---\n\nSalt Harbour hier.", RULES);
    expect(hints.map((h) => h.field)).toEqual(["body"]);
  });
});

describe("checkDraftsNaming", () => {
  test("reports per draft, in draft order", () => {
    const hints = checkDraftsNaming(
      [
        { path: "01-salzhafen/a", markdown: draft("title: A", "Nichts hier.") },
        { path: "01-salzhafen/b", markdown: draft("title: Salt Harbour", "Salt Harbour.") },
      ],
      RULES,
    );
    expect(hints.map((h) => `${h.path}:${h.field}`)).toEqual([
      "01-salzhafen/b:title",
      "01-salzhafen/b:body",
    ]);
  });
});
