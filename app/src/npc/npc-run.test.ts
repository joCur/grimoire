// The NPC run of the generator: the id the DM pins, and the proposed npc as
// the review shows it.

import { describe, expect, test } from "bun:test";

import { translator } from "@/i18n/format";

import { npcIdError, npcOf } from "./npc-run";

const t = translator("de");

describe("npcIdError", () => {
  test("an empty field is not an error — it means 'the model chooses'", () => {
    expect(npcIdError("", [], t)).toBeUndefined();
  });

  test("accepts kebab ids", () => {
    expect(npcIdError("grella", [], t)).toBeUndefined();
    expect(npcIdError("die-graue-witwe", [], t)).toBeUndefined();
    expect(npcIdError("wache-2", [], t)).toBeUndefined();
  });

  test("rejects what the server would reject", () => {
    expect(npcIdError("Grella", [], t)).toContain("Kleinbuchstaben");
    expect(npcIdError("die graue", [], t)).toContain("Leerzeichen");
    expect(npcIdError("npcs/grella", [], t)).toContain("Schrägstriche");
    expect(npcIdError("grella_2", [], t)).toContain("Kleinbuchstaben");
    expect(npcIdError("-grella", [], t)).toContain("Kleinbuchstaben");
    expect(npcIdError("gräfin", [], t)).toContain("Kleinbuchstaben");
  });

  test("an id whose entry exists is named as such — the server would 409", () => {
    expect(npcIdError("fenn", ["fenn", "jorna"], t)).toContain("existiert schon");
    expect(npcIdError("grella", ["fenn", "jorna"], t)).toBeUndefined();
  });
});

describe("npcOf", () => {
  test("changes lie on the proposal in order, and `null` clears a field", () => {
    const proposed = { id: "grella", name: "Grella", status: "unknown" as const, body: "s", voice: "leise" };
    const stored = { role: "Fischerin", body: "Neu.\n" };
    expect(npcOf(proposed, stored, { voice: null })).toEqual({
      id: "grella",
      name: "Grella",
      status: "unknown",
      role: "Fischerin",
      body: "Neu.\n",
    });
    // Nothing laid on it: the proposal as the run made it.
    expect(npcOf(proposed, undefined)).toEqual(proposed);
  });
});
