// The npc a review note introduces: the name the note probably means, and the
// id proposed from it for the dialog that creates the npc.

import { describe, expect, test } from "bun:test";

import { deriveNpcSlug, isNpcSlug, npcNameFromText } from "./npc-from-note";

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
