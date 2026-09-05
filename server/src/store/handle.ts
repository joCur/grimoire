// The process-wide database handle (issue #57, planning #52 Scheibe 2).
//
// After the cutover the database is the ONLY truth: every read and every
// write endpoint goes through the store modules next to this file, and
// CAMPAIGN_ROOT is touched exactly once — by the one-time migration this
// module kicks off on the first access (planning section 3).
//
// The handle is opened LAZILY rather than at module import, for the same
// reason the watcher used to be: importing the app for in-process tests must
// stay free of side effects. The first request opens the file, runs the
// schema migrator (client.ts) and then the initial import; every later call
// gets the memoized handle.

import { getCampaignRoot, getDbFile } from "../config";
import { openDb, type GrimoireDb, type OpenDb } from "../db/client";
import { runInitialMigration, type MigrationOutcome } from "../db/migrate-campaigns";

/** What `initStore` was called with — reported on boot. */
export interface StoreInfo {
  /** The database file (or `:memory:`). */
  file: string;
  /** Which SQLite backend the driver picked. */
  backend: string;
  /** Outcome of the one-time migration attempt of this boot. */
  migration: MigrationOutcome;
}

let opened: OpenDb | null = null;
let info: StoreInfo | null = null;
let opening: Promise<GrimoireDb> | null = null;

/**
 * Open the database and run the one-time migration. Idempotent: a second
 * call returns the same handle, and concurrent first calls share one open.
 *
 * `file` defaults to `GRIMOIRE_DATA/grimoire.db`, `campaignRoot` to
 * CAMPAIGN_ROOT — the two env-driven values of config.ts. Tests pass
 * `:memory:` plus a temp campaign root and get a freshly seeded database.
 */
export async function initStore(
  options: { file?: string; campaignRoot?: string } = {},
): Promise<GrimoireDb> {
  if (opened !== null) return opened.db;
  if (opening !== null) return opening;
  const file = options.file ?? getDbFile();
  const root = options.campaignRoot ?? getCampaignRoot();
  opening = (async () => {
    const handle = await openDb(file);
    // The migration NEVER overwrites: an already-migrated or simply
    // non-empty database is left alone (migrate-campaigns.ts rule 2), so
    // running this on every boot is the documented behaviour, not a risk.
    const migration = await runInitialMigration(handle.db, root);
    opened = handle;
    info = { file, backend: handle.client.backend, migration };
    return handle.db;
  })();
  try {
    return await opening;
  } finally {
    opening = null;
  }
}

/**
 * The database handle, opening it on first use. Every store function starts
 * here — nothing above the store ever sees a SQLite API.
 */
export async function getDb(): Promise<GrimoireDb> {
  if (opened !== null) return opened.db;
  return initStore();
}

/** Boot diagnostics; undefined until the store has been opened. */
export function storeInfo(): StoreInfo | undefined {
  return info ?? undefined;
}

/**
 * Close the handle and forget it. Used by the tests between cases (each one
 * gets its own in-memory database) and by nothing else — the server keeps
 * the connection for its whole life.
 */
export function closeStore(): void {
  opened?.close();
  opened = null;
  info = null;
}
