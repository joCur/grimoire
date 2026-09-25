// The short form of a scene the reference preview shows: which fields it
// reads, and that a `[[slug]]` inside reads as a name.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { sceneExcerpt, type ExcerptSource } from "./entity-excerpt";

const FIXTURES = path.resolve(import.meta.dirname, "../../../fixtures/beispiel");

/** A fixture scene of the example campaign, as the API answers it. */
function fixture(stem: string): ExcerptSource {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${stem}.json`), "utf8")) as ExcerptSource;
}

const NAMES: Record<string, string> = {
  jorna: "Hafenmeisterin Jorna",
  fenn: "Fenn",
};
const nameOf = (slug: string): string | undefined => NAMES[slug];

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
