// The reply of an npc call (decisions/resources): every field of the npc beside the
// model's `warnings`, read by the very reply schema the provider enforced —
// `quickstats` as its list of pairs, folded into the npc's key/value set.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { npcToReply, type NpcProposal } from "@grimoire/shared";
import { NOT_AN_NPC_ERROR, parseNpcReply } from "../src/npc-reply";

function npc(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "grella",
    name: " Grella ",
    role: "Schmugglerin",
    chapter: null,
    status: "alive",
    statblock: "",
    quickstats: [
      { key: "wis", value: "+2" },
      { key: " ", value: "7" },
    ],
    voice: null,
    appearance: null,
    motivation: "Ihren Anteil.",
    body: "\n## Weiß\n\nKennt den Steg.",
    warnings: [" Kein Statblock im Quelltext. ", ""],
    ...over,
  });
}

/** The example campaign's Jorna, as her fixture holds her — the npc without its guard. */
const JORNA = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "fixtures", "beispiel", "npcs", "jorna.json"), "utf8"),
) as NpcProposal;

describe("parseNpcReply", () => {
  test("reads the object as the proposed npc", () => {
    const outcome = parseNpcReply(npc());
    if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
    // Trimmed, a null or blank field left out, a pair without a key dropped,
    // the body in its stored form.
    expect(outcome.reply.npc).toEqual({
      id: "grella",
      name: "Grella",
      role: "Schmugglerin",
      status: "alive",
      quickstats: { wis: "+2" },
      motivation: "Ihren Anteil.",
      body: "## Weiß\n\nKennt den Steg.\n",
    });
    expect(outcome.reply.warnings).toEqual(["Kein Statblock im Quelltext."]);
    expect(outcome.reply.ignored).toEqual([]);
  });

  test("quickstats values stay strings, and no pair is no set at all", () => {
    const outcome = parseNpcReply(npc({ quickstats: [] }));
    if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
    expect(Object.hasOwn(outcome.reply.npc, "quickstats")).toBe(false);
    // A mapping is not the reply form — the schema says pairs.
    const mapping = parseNpcReply(npc({ quickstats: { wis: "+2" } }));
    expect(mapping.ok).toBe(false);
    if (!mapping.ok) expect(mapping.errors.join(" ")).toContain('"quickstats"');
    // A number is not a pair value either.
    const number = parseNpcReply(npc({ quickstats: [{ key: "wis", value: 2 }] }));
    expect(number.ok).toBe(false);
  });

  test("a status outside the four, and a missing one, are named", () => {
    for (const status of ["tot", null]) {
      const outcome = parseNpcReply(npc({ status }));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.errors.join(" ")).toContain('"status"');
    }
  });

  test("a blank name is missing, and a wrong shape is named", () => {
    const blank = parseNpcReply(npc({ name: "  " }));
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.errors.join(" ")).toContain('"name" fehlt');
    const wrong = parseNpcReply(npc({ motivation: 7 }));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.errors.join(" ")).toContain('"motivation"');
  });

  test("an unknown key fails a create run and is dropped by an augment run", () => {
    const created = parseNpcReply(npc({ atmosphere: "Nebel" }));
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.errors.join(" ")).toContain("atmosphere");
    const augmented = parseNpcReply(npc({ atmosphere: "Nebel" }), "augment");
    if (!augmented.ok) throw new Error(augmented.errors.join(" | "));
    expect(augmented.reply.ignored).toEqual(["atmosphere"]);
  });

  test("a `properties` object is not an npc reply", () => {
    const nested = JSON.stringify({
      properties: { id: "grella", name: "Grella", status: "alive" },
      body: "## Text\n",
      warnings: [],
    });
    const outcome = parseNpcReply(nested);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors.join(" ")).toContain("properties");
    expect(parseNpcReply("kein Objekt")).toEqual({ ok: false, errors: [NOT_AN_NPC_ERROR] });
  });

  test("the not-an-object error names every field of the npc", () => {
    for (const key of ["id", "name", "role", "status", "quickstats", "motivation", "body"]) {
      expect(NOT_AN_NPC_ERROR).toContain(`\`${key}\``);
    }
  });
});

describe("npcToReply", () => {
  test("shows a stored npc in the reply form — pairs, strings and nulls", () => {
    const shown = npcToReply(JORNA);
    expect(shown.quickstats).toEqual([
      { key: "insight", value: "2" },
      { key: "passive-perception", value: "12" },
    ]);
    expect(Object.keys(shown)).toEqual([
      "id",
      "name",
      "role",
      "chapter",
      "status",
      "statblock",
      "quickstats",
      "voice",
      "appearance",
      "motivation",
      "body",
    ]);
    expect(npcToReply({ id: "kai", name: "Kai", status: "unknown", body: "" })).toMatchObject({
      role: null,
      quickstats: null,
      motivation: null,
    });
  });

  test("the reply form reads back as the npc it shows", () => {
    const outcome = parseNpcReply(JSON.stringify({ ...npcToReply(JORNA), warnings: [] }));
    if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
    // Every field comes back; a stored number comes back as its string —
    // the one form a pair value has.
    expect(outcome.reply.npc).toEqual({
      ...JORNA,
      quickstats: { insight: "2", "passive-perception": "12" },
      body: JORNA.body.replace(/^\n+/, ""),
    });
  });
});
