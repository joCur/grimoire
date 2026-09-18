// Unit tests of the review helpers: the hashtag vocabulary of log and inbox
// rows, the grouping of player-character notes and the chapter's thread
// checklist. Rows arrive from the server and are marked done by their id, so
// there is no list-out-of-text parsing left to test.

import { describe, expect, test } from "bun:test";

import {
  deriveNpcSlug,
  extractHashtags,
  firstReviewTag,
  groupByPcTag,
  hasPcTag,
  pcGroupTag,
  isNpcSlug,
  isReviewTag,
  npcNameFromText,
  parseChecklist,
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

  test("inbox rule: the row's tag list keeps every tag in order", () => {
    // use-review names an inbox row by its first tag, unless a harvest tag
    // appears later in the text.
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

  test("a row of nothing but hashtags keeps its text", () => {
    expect(stripHashtags("#thread")).toBe("#thread");
  });
});

describe("player-character notes", () => {
  test("hasPcTag matches the exact tag only", () => {
    expect(hasPcTag(extractHashtags("Item #pc #kaela"))).toBe(true);
    // `#pc` inside a longer tag is a DIFFERENT tag — no match.
    expect(hasPcTag(extractHashtags("Notiz #pcs"))).toBe(false);
    expect(hasPcTag(extractHashtags("Notiz #npc"))).toBe(false);
    expect(hasPcTag(extractHashtags("Notiz ohne Tag"))).toBe(false);
  });

  test("hasPcTag ignores the writing case (#PC)", () => {
    expect(hasPcTag(extractHashtags("Item #PC"))).toBe(true);
  });

  test("pcGroupTag is the first tag that is not #pc, lowercased", () => {
    expect(pcGroupTag(extractHashtags("Item #pc #Kaela"))).toBe("kaela");
    expect(pcGroupTag(extractHashtags("Item #kaela #pc"))).toBe("kaela");
  });

  test("pcGroupTag is undefined without a second tag", () => {
    expect(pcGroupTag(extractHashtags("Karte für alle #pc"))).toBeUndefined();
  });

  test("pcGroupTag skips the convention tags — those are no character names", () => {
    // The harvest tags (README) and `#date` describe the ROW, not a person.
    expect(pcGroupTag(extractHashtags("Notiz #pc #thread"))).toBeUndefined();
    expect(pcGroupTag(extractHashtags("Notiz #npc #pc"))).toBeUndefined();
    expect(pcGroupTag(extractHashtags("Notiz #pc #date"))).toBeUndefined();
    expect(pcGroupTag(extractHashtags("Notiz #pc #loot #decision"))).toBeUndefined();
    // …but a character tag next to one of them still wins.
    expect(pcGroupTag(extractHashtags("Notiz #pc #thread #kaela"))).toBe("kaela");
    expect(pcGroupTag(extractHashtags("Notiz #pc #kaela #thread"))).toBe("kaela");
  });

  test("a #pc row wins over the harvest tag it also carries", () => {
    // The two predicates the review model branches on, in that order.
    const tags = extractHashtags("Rückblende für Kaela #pc #thread");
    expect(hasPcTag(tags)).toBe(true);
    expect(firstReviewTag("Rückblende für Kaela #pc #thread")).toBe("thread");
  });

  test("groupByPcTag groups in first-appearance order, the general group last", () => {
    const rows = [
      { text: "Geburtstags-Item für Kaela", tags: ["pc", "kaela"] },
      { text: "Rückblende vorbereiten", tags: ["pc", "brann"] },
      { text: "Allen eine Karte geben", tags: ["pc"] },
      { text: "Karte für Kaela", tags: ["pc", "kaela"] },
    ];
    const grouped = groupByPcTag(rows, (row) => pcGroupTag(row.tags));
    expect(grouped.map((g) => g.tag)).toEqual(["kaela", "brann", undefined]);
    expect(grouped[0]?.entries.map((e) => e.text)).toEqual([
      "Geburtstags-Item für Kaela",
      "Karte für Kaela",
    ]);
  });

  test("groupByPcTag yields no general group when every entry has a tag", () => {
    const grouped = groupByPcTag(
      [{ tag: "kaela" }, { tag: "kaela" }],
      (entry) => entry.tag,
    );
    expect(grouped).toEqual([{ tag: "kaela", entries: [{ tag: "kaela" }, { tag: "kaela" }] }]);
  });

  test("an empty list yields no groups", () => {
    expect(groupByPcTag([], () => undefined)).toEqual([]);
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
