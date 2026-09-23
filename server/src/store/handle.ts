// The process-wide database handle.
//
// The database is the ONLY truth: every read and every write endpoint goes
// through the store modules next to this file. The boot imports nothing — a
// fresh instance simply starts empty.
//
// The handle is opened LAZILY rather than at module import, so that importing
// the app for in-process tests stays free of side effects (no database file
// appearing next to the repository). The first access opens the database file,
// runs the schema migrator (client.ts) and then the job cleanup; every
// later call gets the memoized handle.

import { getDbFile } from "../config";
import { openDb, type GrimoireDb, type OpenDb } from "../db/client";
import { failInterruptedJobs } from "../db/job-boot";

/** What `initStore` was called with — reported on boot. */
export interface StoreInfo {
  /** The database file (or `:memory:`). */
  dbFile: string;
  /** Which SQLite backend the driver picked. */
  backend: string;
  /**
   * How many generator jobs this boot found `running` and had to fail — the
   * runs the previous process took down with it.
   */
  interruptedJobs: number;
}

let opened: OpenDb | null = null;
let info: StoreInfo | null = null;
let opening: Promise<GrimoireDb> | null = null;

/**
 * Open the database and apply the schema migrations. Idempotent: a second
 * call returns the same handle, and concurrent first calls share one open.
 *
 * `dbFile` defaults to `GRIMOIRE_DATA/grimoire.db`. Nothing is imported here —
 * an empty database stays empty; tests pass `:memory:` and
 * seed themselves from the fixtures when they need content.
 */
export async function initStore(options: { dbFile?: string } = {}): Promise<GrimoireDb> {
  if (opened !== null) return opened.db;
  if (opening !== null) return opening;
  const dbFile = options.dbFile ?? getDbFile();
  opening = (async () => {
    const handle = await openDb(dbFile);
    // A generator job cannot outlive the process that ran it: the provider
    // call is gone, so a `running` row left behind by a restart or a crash is
    // failed here — with an error code the app has a sentence for — instead
    // of being polled forever. Finished jobs are untouched and stay
    // applyable.
    const interruptedJobs = failInterruptedJobs(handle.db);
    opened = handle;
    info = { dbFile, backend: handle.client.backend, interruptedJobs };
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
