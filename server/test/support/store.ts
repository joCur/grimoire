// Test setup for the database-backed API.
//
// Every test case gets its OWN in-memory database, seeded from the committed
// JSON fixtures in `fixtures/beispiel` through the real seed loader
// (src/db/seed.ts) — the same call `grimoire seed` makes. Those fixtures are
// the fixture of the whole suite (CLAUDE.md, "Arbeitsweise"), and because
// they are written in the shape the API speaks, there is no second data
// format anywhere.
//
// The seeding is EXPLICIT: the boot loads nothing, so a case that wants
// content asks for it. Why in-memory: same driver, same schema migrations,
// same loader as production, no cleanup, and each case is independent.
//
// A case that needs a DIFFERENT campaign than the fixture describes says so
// in the call instead of building one, entity by entity: `npcs: [...]` adds
// npcs and REPLACES a fixture npc of the same id, `without: { npcs: [...] }`
// drops fixture npcs by their id — and the same for every other entity. That
// keeps the difference to the fixture readable in the test itself.

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CampaignSeed } from "@grimoire/shared/campaign";
import type { ChapterProposal } from "@grimoire/shared/chapter";
import type { LocationProposal } from "@grimoire/shared/location";
import type { NpcProposal } from "@grimoire/shared/npc";
import type { SceneProposal } from "@grimoire/shared/scene";
import type { GrimoireDb } from "../../src/db/client";
import { readFixtureCampaign, seedCampaign, type SeedSession } from "../../src/db/seed";
import { closeStore, initStore } from "../../src/store/handle";

/** The committed fixture campaigns — read-only for the suite. */
export const FIXTURES = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../fixtures",
);

/** The example campaign every case starts from. */
const BEISPIEL = path.join(FIXTURES, "beispiel");

/**
 * What a case changes about the example campaign, entity by entity. Each
 * list ADDS its objects, and one whose id matches a fixture object REPLACES
 * it — that is how a case says "the same campaign, but this npc looks like
 * so" without restating the rest.
 */
export interface SeedOverrides {
  /** Replaces the example campaign's own row. */
  campaign?: CampaignSeed;
  chapters?: ChapterProposal[];
  scenes?: SceneProposal[];
  npcs?: NpcProposal[];
  locations?: LocationProposal[];
  sessions?: SeedSession[];
  /** Fixture objects to leave out, by their id, e.g. `{ sessions: ["2026-01-15"] }`. */
  without?: {
    chapters?: string[];
    scenes?: string[];
    npcs?: string[];
    locations?: string[];
    sessions?: string[];
  };
}

/**
 * The fixture's objects of one entity, minus the ids `without` names and the
 * ones `added` replaces, followed by `added` — so a replacement lands at the
 * end of its entity's load, not where the fixture object sat.
 */
function merged<T>(
  fixture: T[] | undefined,
  added: T[] | undefined,
  without: string[] | undefined,
  id: (value: T) => unknown,
): T[] {
  const gone = new Set<unknown>([...(without ?? []), ...(added ?? []).map(id)]);
  return [...(fixture ?? []).filter((value) => !gone.has(id(value))), ...(added ?? [])];
}

const byId = (value: { id: string }): string => value.id;

/**
 * A fresh in-memory database holding the fixture campaign, plus whatever
 * `overrides` change about it. Call it in `beforeEach`; it closes any
 * database a previous case left open.
 */
export async function seedStore(overrides: SeedOverrides = {}): Promise<GrimoireDb> {
  closeStore();
  const db = await initStore({ dbFile: ":memory:" });
  const fixture = await readFixtureCampaign(BEISPIEL);
  const without = overrides.without ?? {};
  seedCampaign(db, {
    ...fixture,
    campaign: overrides.campaign ?? fixture.campaign,
    chapters: merged(fixture.chapters, overrides.chapters, without.chapters, byId),
    scenes: merged(fixture.scenes, overrides.scenes, without.scenes, byId),
    npcs: merged(fixture.npcs, overrides.npcs, without.npcs, byId),
    locations: merged(fixture.locations, overrides.locations, without.locations, byId),
    sessions: merged(
      fixture.sessions,
      overrides.sessions,
      without.sessions,
      (session) => session.properties.id,
    ),
  });
  return db;
}

/** A fresh, EMPTY in-memory database — the production boot's starting point. */
export async function emptyStore(): Promise<GrimoireDb> {
  closeStore();
  return initStore({ dbFile: ":memory:" });
}

/** Close the database of the current case. Call it in `afterEach`. */
export function dropStore(): void {
  closeStore();
}
