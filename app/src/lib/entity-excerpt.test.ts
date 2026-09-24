// The short forms the aside cards and the reference preview share: which
// fields they read, and that a `[[slug]]` inside an excerpt reads as a name.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import type { Location, Npc } from "@grimoire/shared/types";

import { locationExcerpt, npcExcerpt, sceneExcerpt, type ExcerptSource } from "./entity-excerpt";

const FIXTURES = path.resolve(import.meta.dirname, "../../../fixtures/beispiel");

/** A fixture entry of the example campaign, as the API answers it. */
function fixture(stem: string): ExcerptSource {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${stem}.json`), "utf8")) as ExcerptSource;
}

/** An npc fixture — the npc as its resource answers it (ADR #31). */
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

/** A location fixture — the location as its resource answers it (ADR #31). */
function locationFixture(id: string): Location {
  const stored = JSON.parse(
    readFileSync(path.join(FIXTURES, "locations", `${id}.json`), "utf8"),
  ) as Omit<Location, "rev">;
  return { ...stored, rev: 1 };
}

/** A location of nothing but what a case names. */
function location(fields: Partial<Location>): Location {
  return { id: "ort", name: "Ort", body: "", rev: 1, ...fields };
}

const NAMES: Record<string, string> = {
  jorna: "Hafenmeisterin Jorna",
  fenn: "Fenn",
  bucht: "Die Nordbucht",
};
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
    const grella = npc({ motivation: "[[fenn]] loswerden, bevor [[niemand]] fragt." });
    expect(npcExcerpt(grella, nameOf).will).toBe("Fenn loswerden, bevor [[niemand]] fragt.");
  });

  test("…but a reference quoted as code stays code", () => {
    const grella = npc({ motivation: "Schreibt `[[fenn]]` an jede Wand." });
    expect(npcExcerpt(grella, nameOf).will).toBe("Schreibt `[[fenn]]` an jede Wand.");
  });

  test("a `## Will` section in the body is not read — only the field is", () => {
    const grella = npc({ body: "## Will\n\nDas steht im Text und bleibt Text.\n" });
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

describe("locationExcerpt", () => {
  test("the `atmosphere` field and the Roll20 page", () => {
    expect(locationExcerpt(locationFixture("bucht"), nameOf)).toEqual({
      mood: "Arbeit, keine Romantik: Kisten unter Planen, ausgetretene Pfade, niemand redet laut.",
      page: "Nordbucht",
    });
  });

  test("a reference in the atmosphere reads as the current name", () => {
    const entry = location({ atmosphere: "Hier riecht es nach [[fenn]]s Tabak." });
    expect(locationExcerpt(entry, nameOf).mood).toBe("Hier riecht es nach Fenns Tabak.");
  });

  test("a `## Atmosphäre` section in the body is not read — only the field is", () => {
    const entry = location({
      roll20Page: "Bucht",
      body: "## Atmosphäre\n\nDas steht im Text und bleibt Text.\n",
    });
    expect(locationExcerpt(entry, nameOf)).toEqual({ mood: undefined, page: "Bucht" });
  });
});

describe("sceneExcerpt", () => {
  test("type, trigger, the location's display name and status", () => {
    const excerpt = sceneExcerpt(
      fixture("scene-smuggler-captured"),
      (id) => (id === "bucht" ? "Die Nordbucht" : undefined),
      nameOf,
    );
    expect(excerpt).toEqual({
      type: "contingency",
      trigger: "Charaktere werden beim Auskundschaften der Bucht entdeckt",
      location: "Die Nordbucht",
      status: "ready",
    });
  });

  test("a location nobody knows stays as written; no trigger, no row", () => {
    const excerpt = sceneExcerpt(
      { properties: { type: "planned", location: "irgendwo" } },
      () => undefined,
      nameOf,
    );
    expect(excerpt.location).toBe("irgendwo");
    expect(excerpt.trigger).toBeUndefined();
    // A scene without a stored status reads as the default every creation writes.
    expect(excerpt.status).toBe("draft");
  });

  test("the location is looked up as a LOCATION, not by reference priority", () => {
    // `fenn` is an npc for `[[…]]`; as a scene's location only the location
    // lookup answers.
    const excerpt = sceneExcerpt(
      { properties: { location: "fenn" } },
      () => undefined,
      nameOf,
    );
    expect(excerpt.location).toBe("fenn");
  });

  test("a reference in the trigger reads as the current name", () => {
    const excerpt = sceneExcerpt(
      { properties: { trigger: "[[jorna]] schlägt Alarm" } },
      () => undefined,
      nameOf,
    );
    expect(excerpt.trigger).toBe("Hafenmeisterin Jorna schlägt Alarm");
  });
});
