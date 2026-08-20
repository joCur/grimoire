// Unit tests of the review helpers (issue #10). The hash test is the
// important one: the short hash MUST byte-match the server
// (server/src/campaign-write.ts `shortLineHash`, asserted in
// server/test/review-api.test.ts) — the app compares its own WebCrypto
// digest against the `reviewed` list the server wrote.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  deriveNpcSlug,
  extractHashtags,
  firstReviewTag,
  harvestInboxEntries,
  isNpcSlug,
  isReviewTag,
  npcNameFromText,
  parseChecklist,
  parseInboxEntries,
  shortLineHash,
  shortLineHashes,
  stripHashtags,
} from "./review";

describe("extractHashtags", () => {
  test("collects hashtags in order, lowercased", () => {
    expect(extractHashtags("Lichter in der Bucht #thread #Loot")).toEqual(["thread", "loot"]);
  });

  test("handles umlauts and digits, ignores lone hashes", () => {
    expect(extractHashtags("Nebelöl #öl-fass #date2 # nichts")).toEqual(["öl-fass", "date2"]);
  });

  test("no hashtags yields an empty list", () => {
    expect(extractHashtags("— Pause")).toEqual([]);
  });
});

describe("firstReviewTag", () => {
  test("picks the first REVIEW tag, skipping others", () => {
    expect(firstReviewTag("#date Tag 4 und #thread offen")).toBe("thread");
    expect(firstReviewTag("Spuren gefunden #decision")).toBe("decision");
    expect(firstReviewTag("Improvisiert: Metta #npc")).toBe("npc");
    expect(firstReviewTag("Kiste #loot")).toBe("loot");
  });

  test("undefined without a review tag — those lines stay in the log", () => {
    expect(firstReviewTag("#date Tag 4")).toBeUndefined();
    expect(firstReviewTag("— Pause")).toBeUndefined();
  });

  test("isReviewTag knows the four harvest tags", () => {
    for (const tag of ["thread", "npc", "loot", "decision"]) expect(isReviewTag(tag)).toBe(true);
    for (const tag of ["date", "idee", ""]) expect(isReviewTag(tag)).toBe(false);
  });

  test("inbox rule: the entry's tag list keeps every tag in order", () => {
    // use-review names an inbox entry by its first tag, unless a harvest tag
    // appears later in the line (see harvestInboxEntries consumers).
    expect(extractHashtags("Idee zum Hafen #idee #npc")).toEqual(["idee", "npc"]);
  });
});

describe("stripHashtags", () => {
  test("removes hashtags and collapses whitespace", () => {
    expect(stripHashtags("Cliffhanger: Lichter in der Bucht #thread")).toBe(
      "Cliffhanger: Lichter in der Bucht",
    );
    expect(stripHashtags("#thread Lichter #loot in der Bucht")).toBe("Lichter in der Bucht");
  });

  test("a line of nothing but hashtags keeps its text", () => {
    expect(stripHashtags("#thread")).toBe("#thread");
  });
});

describe("parseInboxEntries", () => {
  const body = `
## Eingang

- 2026-01-10 Idee: Der Dorfschmied repariert Schmugglerwerkzeug #thread
- [x] 2026-01-09 Alte Idee #thread
- [ ] 2026-01-11 Offene Idee #npc
- Ohne Datum und ohne Tag
  - eingerückt, kein Eintrag #thread
Kein Listeneintrag #thread
`;

  test("parses date, tags, display text and the done marker", () => {
    const entries = parseInboxEntries(body);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({
      index: 3,
      raw: "- 2026-01-10 Idee: Der Dorfschmied repariert Schmugglerwerkzeug #thread",
      text: "Idee: Der Dorfschmied repariert Schmugglerwerkzeug",
      tags: ["thread"],
      done: false,
      date: "2026-01-10",
    });
    expect(entries[1]?.done).toBe(true);
    expect(entries[1]?.text).toBe("Alte Idee");
    expect(entries[2]?.done).toBe(false);
    expect(entries[2]?.tags).toEqual(["npc"]);
    expect(entries[3]?.tags).toEqual([]);
  });

  test("keeps the raw line byte-identical (inbox-done matches it exactly)", () => {
    const raw = parseInboxEntries(body).map((e) => e.raw);
    for (const line of raw) expect(body.split("\n")).toContain(line);
  });

  test("skips indented lines and non-list lines", () => {
    const texts = parseInboxEntries(body).map((e) => e.text);
    expect(texts).not.toContain("eingerückt, kein Eintrag");
    expect(texts).not.toContain("Kein Listeneintrag");
  });

  test("degrades: no list lines yields an empty list", () => {
    expect(parseInboxEntries("")).toEqual([]);
    expect(parseInboxEntries("---\nid: inbox\n---\n\n## Eingang\n")).toEqual([]);
  });
});

describe("harvestInboxEntries", () => {
  const body = [
    "- 2026-01-10 Offen #thread",
    "- [x] 2026-01-09 Erledigt #thread",
    "- Ohne Tag",
  ].join("\n");

  test("skips `- [x]` lines and untagged lines", () => {
    expect(harvestInboxEntries(body).map((e) => e.text)).toEqual(["Offen"]);
  });

  test("keeps a done line that was acted on in this session", () => {
    expect(harvestInboxEntries(body, new Set([1])).map((e) => e.text)).toEqual([
      "Offen",
      "Erledigt",
    ]);
  });
});

describe("parseChecklist", () => {
  const body = `---
---

## Ziel des Kapitels

Text.

## Offene Fäden

- [ ] Wer bezahlt die Schmuggler?
- [x] Leuchtfeuer geprüft
- kein Kästchen

## Notizen

- [ ] gehört nicht dazu
`;

  test("reads the checkbox items of the section only", () => {
    expect(parseChecklist(body, "Offene Fäden")).toEqual([
      { text: "Wer bezahlt die Schmuggler?", done: false },
      { text: "Leuchtfeuer geprüft", done: true },
    ]);
  });

  test("missing section degrades to an empty list", () => {
    expect(parseChecklist(body, "Gibt es nicht")).toEqual([]);
    expect(parseChecklist("", "Offene Fäden")).toEqual([]);
  });
});

describe("npc slug derivation", () => {
  test("prefers a quoted name (the log convention)", () => {
    expect(npcNameFromText('Improvisiert: Fischerin "Old Metta" am Steg')).toBe("Old Metta");
    expect(deriveNpcSlug('Improvisiert: Fischerin "Old Metta" am Steg')).toBe("old-metta");
    expect(deriveNpcSlug("Improvisiert: Fischerin „Alte Metta“ am Steg")).toBe("alte-metta");
  });

  test("falls back to the first capitalized run, skipping labels", () => {
    expect(deriveNpcSlug("Improvisiert: Alte Metta am Steg")).toBe("alte-metta");
    expect(deriveNpcSlug("Neuer NPC: Kai Wellenläufer taucht auf")).toBe("kai-wellenlaeufer");
  });

  test("transliterates umlauts and folds diacritics", () => {
    expect(deriveNpcSlug('"Bärbel Öhler"')).toBe("baerbel-oehler");
    expect(deriveNpcSlug('"Renée"')).toBe("renee");
    expect(deriveNpcSlug('"Straßenkind"')).toBe("strassenkind");
  });

  test("no recognizable name yields an empty proposal", () => {
    expect(deriveNpcSlug("jemand am steg")).toBe("");
    expect(npcNameFromText("jemand am steg")).toBeUndefined();
  });

  test("every derived slug passes the server's slug rule", () => {
    const texts = [
      'Improvisiert: Fischerin "Old Metta" am Steg',
      '"Bärbel Öhler"',
      "Neuer NPC: Kai Wellenläufer taucht auf",
    ];
    for (const text of texts) expect(isNpcSlug(deriveNpcSlug(text))).toBe(true);
  });

  test("isNpcSlug mirrors the server (kebab-case only)", () => {
    expect(isNpcSlug("old-metta")).toBe(true);
    expect(isNpcSlug("a1")).toBe(true);
    for (const bad of ["Old Metta", "old_metta", "-metta", "metta-", "a--b", "", "a/b", "ä", "A1"]) {
      expect(isNpcSlug(bad)).toBe(false);
    }
  });
});

describe("shortLineHash", () => {
  // Same line as server/test/review-api.test.ts — the known vector.
  const LINE =
    "- 19:52 (lighthouse-arrival) Spuren gefunden, Gruppe will sofort zur Bucht #decision";

  test("matches the documented vector (8 hex chars of SHA-256)", async () => {
    expect(await shortLineHash(LINE)).toBe("fb75a8cd");
  });

  test("byte-matches node's sha-256 prefix, umlauts included", async () => {
    const lines = [
      LINE,
      '- 21:10 (lighthouse-arrival) Improvisiert: Fischerin "Old Metta" am Steg #npc',
      "- 22:40 — Cliffhanger: Lichter in der Bucht gesichtet #thread",
      "- Ölfässer, Straße, Käse #loot",
    ];
    for (const line of lines) {
      const expected = createHash("sha256").update(line, "utf8").digest("hex").slice(0, 8);
      expect(await shortLineHash(line)).toBe(expected);
    }
  });

  test("shortLineHashes maps every line, duplicates collapsed", async () => {
    const map = await shortLineHashes([LINE, LINE, "- x #thread"]);
    expect(Object.keys(map)).toEqual([LINE, "- x #thread"]);
    expect(map[LINE]).toBe(await shortLineHash(LINE));
  });
});

// Lead follow-up: a leading em dash is log formatting, not content.
import { test as leadTest, expect as leadExpect } from "bun:test";
leadTest("stripHashtags drops a leading em dash", () => {
  leadExpect(stripHashtags("— Cliffhanger: Lichter in der Bucht #thread")).toBe(
    "Cliffhanger: Lichter in der Bucht",
  );
});
