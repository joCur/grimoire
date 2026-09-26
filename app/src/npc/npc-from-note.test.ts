// The npc a review note introduces: the name the note probably means, and the
// id proposed from it for the dialog that creates the npc.

import { describe, expect, test } from "bun:test";

import { deriveNpcSlug, isNpcSlug, npcNameFromText } from "./npc-from-note";

describe("npc slug derivation", () => {
  test("prefers a quoted name (the log convention)", () => {
    expect(npcNameFromText('Improvised: fisherwoman "Old Metta" at the jetty')).toBe("Old Metta");
    expect(deriveNpcSlug('Improvised: fisherwoman "Old Metta" at the jetty')).toBe("old-metta");
    // German low-high quotes count as quotes too.
    expect(deriveNpcSlug("Improvised: fisherwoman „Grey Metta“ at the jetty")).toBe("grey-metta");
  });

  test("falls back to the first capitalized run, skipping labels", () => {
    expect(deriveNpcSlug("Improvised: Grey Metta at the jetty")).toBe("grey-metta");
    expect(deriveNpcSlug("New NPC: Kai Wavewalker shows up")).toBe("kai-wavewalker");
  });

  test("transliterates umlauts and folds diacritics", () => {
    expect(deriveNpcSlug('"Bärbel Öhler"')).toBe("baerbel-oehler");
    expect(deriveNpcSlug('"Renée"')).toBe("renee");
    expect(deriveNpcSlug('"Straßenkind"')).toBe("strassenkind");
  });

  test("no recognizable name yields an empty proposal", () => {
    expect(deriveNpcSlug("someone at the jetty")).toBe("");
    expect(npcNameFromText("someone at the jetty")).toBeUndefined();
  });

  test("every derived slug passes the server's slug rule", () => {
    const texts = [
      'Improvised: fisherwoman "Old Metta" at the jetty',
      '"Bärbel Öhler"',
      "New NPC: Kai Wavewalker shows up",
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
