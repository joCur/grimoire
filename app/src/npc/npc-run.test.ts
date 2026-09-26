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
    expect(npcIdError("the-grey-widow", [], t)).toBeUndefined();
    expect(npcIdError("guard-2", [], t)).toBeUndefined();
  });

  test("rejects what the server would reject", () => {
    expect(npcIdError("Grella", [], t)).toBe(t("generate.input.npcId.charset"));
    expect(npcIdError("the grey", [], t)).toBe(t("generate.input.npcId.space"));
    expect(npcIdError("npcs/grella", [], t)).toBe(t("generate.input.npcId.slash"));
    expect(npcIdError("grella_2", [], t)).toBe(t("generate.input.npcId.charset"));
    expect(npcIdError("-grella", [], t)).toBe(t("generate.input.npcId.charset"));
    expect(npcIdError("gräfin", [], t)).toBe(t("generate.input.npcId.charset"));
  });

  test("an id whose entry exists is named as such — the server would 409", () => {
    expect(npcIdError("fenn", ["fenn", "jorna"], t)).toBe(t("generate.input.npcId.exists"));
    expect(npcIdError("grella", ["fenn", "jorna"], t)).toBeUndefined();
  });
});

describe("npcOf", () => {
  test("changes lie on the proposal in order, and `null` clears a field", () => {
    const proposed = { id: "grella", name: "Grella", status: "unknown" as const, body: "s", voice: "quiet" };
    const stored = { role: "Fisherwoman", body: "New.\n" };
    expect(npcOf(proposed, stored, { voice: null })).toEqual({
      id: "grella",
      name: "Grella",
      status: "unknown",
      role: "Fisherwoman",
      body: "New.\n",
    });
    // Nothing laid on it: the proposal as the run made it.
    expect(npcOf(proposed, undefined)).toEqual(proposed);
  });
});
