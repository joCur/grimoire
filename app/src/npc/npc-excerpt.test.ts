// The short form of an npc its cards, its preview and its reading view
// share: which fields it reads, and that a `[[slug]]` inside reads as a name.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import type { Npc } from "@grimoire/shared/npc";

import { npcExcerpt } from "./npc-excerpt";

const FIXTURES = path.resolve(import.meta.dirname, "../../../fixtures/beispiel");

/** An npc fixture — the npc as its resource answers it (decisions/resources). */
function npcFixture(id: string): Npc {
  const stored = JSON.parse(
    readFileSync(path.join(FIXTURES, "npcs", `${id}.json`), "utf8"),
  ) as Omit<Npc, "rev">;
  return { ...stored, rev: 1 };
}

/** An npc of nothing but what a case names. */
function npc(fields: Partial<Npc>): Npc {
  return { id: "grella", name: "Grella", status: "unknown", body: "", rev: 1, ...fields };
}

const NAMES: Record<string, string> = { fenn: "Fenn" };
const nameOf = (slug: string): string | undefined => NAMES[slug];

describe("npcExcerpt", () => {
  test("role, voice, the `motivation` property, quick stats and status", () => {
    const excerpt = npcExcerpt(npcFixture("fenn"), nameOf);
    expect(excerpt.role).toBe("Anführer der Schmuggler in der Nordbucht");
    expect(excerpt.voice).toBe("leise, höflich — wird stiller, je gefährlicher es wird");
    expect(excerpt.will).toBe(
      "Den Auftrag zu Ende bringen, ohne dass jemand stirbt — er ist Schmuggler, kein Mörder, und das ist sein wunder Punkt.",
    );
    expect(excerpt.quickstats).toEqual([
      ["wis", "2"],
      ["insight", "2"],
      ["passive-perception", "13"],
    ]);
    expect(excerpt.status).toBe("alive");
  });

  test("a reference in the motivation reads as the current name — no brackets", () => {
    const grella = npc({ motivation: "Get rid of [[fenn]] before [[nobody]] asks." });
    expect(npcExcerpt(grella, nameOf).will).toBe("Get rid of Fenn before [[nobody]] asks.");
  });

  test("…but a reference quoted as code stays code", () => {
    const grella = npc({ motivation: "Writes `[[fenn]]` on every wall." });
    expect(npcExcerpt(grella, nameOf).will).toBe("Writes `[[fenn]]` on every wall.");
  });

  test("a `## Will` section in the body is not read — only the field is", () => {
    const grella = npc({ body: "## Will\n\nThis stands in the text and stays text.\n" });
    expect(npcExcerpt(grella, nameOf).will).toBeUndefined();
  });

  test("an empty npc has nothing to show but its status", () => {
    expect(npcExcerpt(npc({}), nameOf)).toEqual({
      role: undefined,
      voice: undefined,
      will: undefined,
      quickstats: [],
      status: "unknown",
    });
  });
});
