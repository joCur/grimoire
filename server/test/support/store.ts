// Test setup for the database-backed API.
//
// Every test case gets its OWN in-memory database, seeded through the real
// markdown importer from a campaign tree — `examples/` by default, which is
// what makes the committed example campaign the fixture of the whole suite
// (CLAUDE.md, "Arbeitsweise") without a second data
// format anywhere.
//
// The seeding is EXPLICIT: the boot imports nothing, so a
// test that wants content runs the importer itself — exactly what `grimoire
// seed` does. Why in-memory: same driver, same schema migrations, same
// importer as production, no cleanup, and each case is independent.

import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GrimoireDb } from "../../src/db/client";
import { runInitialMigration } from "../../src/db/migrate-campaigns";
import { closeStore, initStore } from "../../src/store/handle";

/** The committed example campaign — read-only for the suite. */
export const EXAMPLES = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../examples");

/**
 * A fresh in-memory database, seeded from `root` (default: `examples/`) with
 * the real importer — the same call `grimoire seed` makes. Call it in
 * `beforeEach`; it closes any database a previous case left open.
 */
export async function seedStore(root?: string): Promise<GrimoireDb> {
  closeStore();
  const db = await initStore({ file: ":memory:" });
  await runInitialMigration(db, root ?? EXAMPLES);
  return db;
}

/** A fresh, EMPTY in-memory database — the production boot's starting point. */
export async function emptyStore(): Promise<GrimoireDb> {
  closeStore();
  return initStore({ file: ":memory:" });
}

/** Close the database of the current case. Call it in `afterEach`. */
export function dropStore(): void {
  closeStore();
}

/**
 * A temp copy of `examples/` as a CAMPAIGN ROOT, for cases that need to seed
 * from a modified tree (a broken file, a second campaign, a missing
 * `_campaign`). The server never writes into it — the tree is only ever
 * the importer's source.
 */
export async function tempCampaignRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "grimoire-root-"));
  await cp(EXAMPLES, dir, { recursive: true });
  return dir;
}

/** Drop a temp root created above. */
export async function removeTempRoot(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
