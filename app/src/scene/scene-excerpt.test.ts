// The short form of a scene the reference preview shows: which fields it
// reads, and that a `[[slug]]` inside reads as a name.

import { readFileSync } from "node:fs";
import path from "node:path";

import type { SceneProposal } from "@grimoire/shared/scene";
import { describe, expect, test } from "bun:test";

import { sceneExcerpt } from "./scene-excerpt";

const FIXTURES = path.resolve(import.meta.dirname, "../../../fixtures/beispiel");

/** A scene fixture — the scene as its resource answers it (decisions/resources). */
function fixture(id: string): SceneProposal {
  return JSON.parse(
    readFileSync(path.join(FIXTURES, "scenes", `${id}.json`), "utf8"),
  ) as SceneProposal;
}

const NAMES: Record<string, string> = {
  jorna: "Harbourmaster Jorna",
  fenn: "Fenn",
};
const nameOf = (slug: string): string | undefined => NAMES[slug];

/** The fields a short form reads, for the cases no fixture covers. */
const planned = { type: "planned", status: "draft" } as const;

describe("sceneExcerpt", () => {
  test("type, trigger, the location's display name and status", () => {
    const excerpt = sceneExcerpt(
      fixture("smuggler-captured"),
      (id) => (id === "bucht" ? "The North Cove" : undefined),
      nameOf,
    );
    expect(excerpt).toEqual({
      type: "contingency",
      trigger: "Charaktere werden beim Auskundschaften der Bucht entdeckt",
      location: "The North Cove",
      status: "ready",
    });
  });

  test("a location nobody knows stays as written; no trigger, no row", () => {
    const excerpt = sceneExcerpt({ ...planned, location: "somewhere" }, () => undefined, nameOf);
    expect(excerpt.location).toBe("somewhere");
    expect(excerpt.trigger).toBeUndefined();
    expect(excerpt.status).toBe("draft");
  });

  test("the location is looked up as a LOCATION, not by reference priority", () => {
    // `fenn` is an npc for `[[…]]`; as a scene's location only the location
    // lookup answers.
    const excerpt = sceneExcerpt({ ...planned, location: "fenn" }, () => undefined, nameOf);
    expect(excerpt.location).toBe("fenn");
  });

  test("a reference in the trigger reads as the current name", () => {
    const excerpt = sceneExcerpt(
      { ...planned, trigger: "[[jorna]] raises the alarm" },
      () => undefined,
      nameOf,
    );
    expect(excerpt.trigger).toBe("Harbourmaster Jorna raises the alarm");
  });
});
