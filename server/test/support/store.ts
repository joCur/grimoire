// Test setup for the database-backed API.
//
// Every test case gets its OWN in-memory database, seeded from the committed
// JSON entries in `fixtures/beispiel` through the real seed loader
// (src/db/seed.ts) — the same call `grimoire seed` makes. Those entries are
// the fixture of the whole suite (CLAUDE.md, "Arbeitsweise"), and because
// they are written in the shape the API speaks, there is no second data
// format anywhere.
//
// The seeding is EXPLICIT: the boot loads nothing, so a case that wants
// content asks for it. Why in-memory: same driver, same schema migrations,
// same loader as production, no cleanup, and each case is independent.
//
// A case that needs a DIFFERENT campaign than the fixture describes says so
// in the call instead of building one: `without` drops entries by their
// fixture file name, `entries` adds new ones and REPLACES a fixture entry of
// the same kind and id. That keeps the difference to the fixture readable in
// the test itself.

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GrimoireDb } from "../../src/db/client";
import { readFixtureSources, seedCampaign, type SeedEntry } from "../../src/db/seed";
import { closeStore, initStore } from "../../src/store/handle";

/** The committed fixture campaigns — read-only for the suite. */
export const FIXTURES = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../fixtures",
);

/** The example campaign every case starts from. */
const BEISPIEL = path.join(FIXTURES, "beispiel");

export interface SeedOverrides {
  /**
   * Entries to add. One whose kind and id match a fixture entry REPLACES it
   * — that is how a case says "the same campaign, but this npc looks like
   * so" without restating the rest.
   */
  entries?: SeedEntry[];
  /** Fixture file stems to leave out, e.g. `"session-2026-01-15"` or `"scenes/smuggler-captured"`. */
  without?: string[];
}

/** The identity two entries are the same by: kind plus id. */
function identity(entry: SeedEntry): string {
  if (entry.kind === "inbox" || entry.kind === "glossary") return entry.kind;
  if (entry.kind === "location") return `location/${entry.location.id}`;
  if (entry.kind === "npc") return `npc/${entry.npc.id}`;
  if (entry.kind === "scene") return `scene/${entry.scene.id}`;
  const id = entry.properties.id;
  return `${entry.kind}/${typeof id === "string" ? id : ""}`;
}

/**
 * A fresh in-memory database holding the fixture campaign, plus whatever
 * `overrides` change about it. Call it in `beforeEach`; it closes any
 * database a previous case left open.
 */
export async function seedStore(overrides: SeedOverrides = {}): Promise<GrimoireDb> {
  closeStore();
  const db = await initStore({ dbFile: ":memory:" });
  const without = new Set(overrides.without ?? []);
  const added = overrides.entries ?? [];
  const replaced = new Set(added.map(identity));
  const entries = (await readFixtureSources(BEISPIEL))
    .filter((source) => !without.has(source.stem))
    .map((source) => source.entry)
    .filter((entry) => !replaced.has(identity(entry)));
  // The added entries go last, so a replacement lands where its kind is
  // loaded (db/seed.ts sorts by kind) rather than where the fixture sat.
  seedCampaign(db, [...entries, ...added]);
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
