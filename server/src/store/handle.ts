// The process-wide database handle (issue #57, planning #52 Scheibe 2).
//
// After the cutover the database is the ONLY truth: every read and every
// write endpoint goes through the store modules next to this file, and
// CAMPAIGN_ROOT is touched exactly once — by the one-time migration this
// module kicks off on the first access (planning section 3).
//
// The handle is opened LAZILY rather than at module import, so that importing
// the app for in-process tests stays free of side effects (no database file
// appearing next to the repository). The first access opens the file, runs the
// schema migrator (client.ts), then the initial import, then the job cleanup
// of issue #23; every later call gets the memoized handle.

import { getCampaignRoot, getDbFile } from "../config";
import { openDb, type GrimoireDb, type OpenDb } from "../db/client";
import { failInterruptedJobs } from "../db/job-boot";
import { runInitialMigration, type MigrationOutcome } from "../db/migrate-campaigns";
import { backfillReferences } from "./ref-backfill";

/** What `initStore` was called with — reported on boot. */
export interface StoreInfo {
  /** The database file (or `:memory:`). */
  file: string;
  /** Which SQLite backend the driver picked. */
  backend: string;
  /** Outcome of the one-time migration attempt of this boot. */
  migration: MigrationOutcome;
  /**
   * How many generator jobs this boot found `running` and had to fail
   * (issue #23) — the runs the previous process took down with it.
   */
  interruptedJobs: number;
  /**
   * `<campaign>/<npc-id>` per empty npc row this boot created for a dangling
   * reference (issue #70, store/ref-backfill.ts). Empty on every boot after
   * the first — the pass only inserts what has no row.
   */
  backfilledNpcs: string[];
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
    // A generator job cannot outlive the process that ran it (issue #23): the
    // provider call is gone, so a `running` row left behind by a restart or a
    // crash is failed here — with a German sentence the app shows — instead of
    // being polled forever. Finished jobs are untouched and stay applyable.
    const interruptedJobs = failInterruptedJobs(handle.db);
    // Issue #70: a referenced entity is never missing, only empty. Every
    // write path holds that now; this pass holds it for the migrated stock.
    const refBackfill = backfillReferences(handle.db);
    opened = handle;
    info = {
      file,
      backend: handle.client.backend,
      migration,
      interruptedJobs,
      backfilledNpcs: refBackfill.created,
    };
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
