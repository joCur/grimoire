import { describe, expect, test } from "bun:test";
import { NPC_STATUSES, type NpcStatus } from "@grimoire/shared/npc";

import { translator } from "@/i18n/format";
import { npcStatusLabel } from "./npc-status";

// The labels come from the catalog and the translator is passed in, so a test
// says which language it asserts.
const t = translator("de");

describe("npcStatusLabel", () => {
  test("known statuses map to German labels", () => {
    expect(npcStatusLabel("alive", t)).toBe("Lebendig");
    expect(npcStatusLabel("dead", t)).toBe("Tot");
    expect(npcStatusLabel("missing", t)).toBe("Vermisst");
    expect(npcStatusLabel("unknown", t)).toBe("Unbekannt");
  });

  test("every known status of the format has a label", () => {
    for (const status of NPC_STATUSES) {
      expect(npcStatusLabel(status, t)).not.toBe(status);
    }
  });

  test("a value from outside the four is not a status at all", () => {
    // `unknown` above is one of the four — the NPC nobody has placed yet — and
    // the only other case there could be is a foreign value, which the column
    // cannot hold (ADR #25). The type is what says so.
    // @ts-expect-error not one of alive | dead | missing | unknown
    const foreign: NpcStatus = "verschollen im Nebel";
    expect(NPC_STATUSES as readonly string[]).not.toContain(foreign);
  });
});
