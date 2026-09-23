// The short forms the aside cards and the reference preview share: which
// fields they read, and that a `[[slug]]` inside an excerpt reads as a name.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { locationExcerpt, npcExcerpt, sceneExcerpt, type ExcerptSource } from "./entity-excerpt";

const FIXTURES = path.resolve(import.meta.dirname, "../../../fixtures/beispiel");

/** A fixture entry of the example campaign, as the API answers it. */
function fixture(stem: string): ExcerptSource {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${stem}.json`), "utf8")) as ExcerptSource;
}

const NAMES: Record<string, string> = {
  jorna: "Hafenmeisterin Jorna",
  fenn: "Fenn",
  bucht: "Die Nordbucht",
};
const nameOf = (slug: string): string | undefined => NAMES[slug];

describe("npcExcerpt", () => {
  test("role, voice, the first paragraph of `## Will`, quick stats and status", () => {
    const excerpt = npcExcerpt(fixture("npc-fenn"), nameOf);
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

  test("a reference in `## Will` reads as the current name — no brackets", () => {
    const entry = {
      properties: { id: "grella", name: "Grella" },
      body: "## Will\n\nWill [[fenn]] loswerden, bevor [[niemand]] fragt.\n",
    };
    expect(npcExcerpt(entry, nameOf).will).toBe("Will Fenn loswerden, bevor [[niemand]] fragt.");
  });

  test("…but a reference quoted as code stays code", () => {
    const entry = { properties: {}, body: "## Will\n\nSchreibt `[[fenn]]` an jede Wand.\n" };
    expect(npcExcerpt(entry, nameOf).will).toBe("Schreibt `[[fenn]]` an jede Wand.");
  });

  test("an empty entry has nothing to show — every field is simply absent", () => {
    const excerpt = npcExcerpt({ properties: { id: "leer" }, body: "" }, nameOf);
    expect(excerpt).toEqual({
      role: undefined,
      voice: undefined,
      will: undefined,
      quickstats: [],
      status: undefined,
    });
  });
});

describe("locationExcerpt", () => {
  test("the first paragraph of `## Atmosphäre` and the Roll20 page", () => {
    expect(locationExcerpt(fixture("location-bucht"), nameOf)).toEqual({
      mood: "Arbeit, keine Romantik: Kisten unter Planen, ausgetretene Pfade, niemand redet laut.",
      page: "Nordbucht",
    });
  });

  test("a reference in the mood line reads as the current name", () => {
    const entry = { properties: {}, body: "## Atmosphäre\n\nHier riecht es nach [[fenn]]s Tabak.\n" };
    expect(locationExcerpt(entry, nameOf).mood).toBe("Hier riecht es nach Fenns Tabak.");
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
      { properties: { type: "planned", location: "irgendwo" }, body: "" },
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
      { properties: { location: "fenn" }, body: "" },
      () => undefined,
      nameOf,
    );
    expect(excerpt.location).toBe("fenn");
  });

  test("a reference in the trigger reads as the current name", () => {
    const excerpt = sceneExcerpt(
      { properties: { trigger: "[[jorna]] schlägt Alarm" }, body: "" },
      () => undefined,
      nameOf,
    );
    expect(excerpt.trigger).toBe("Hafenmeisterin Jorna schlägt Alarm");
  });
});
