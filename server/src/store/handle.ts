// The process-wide database handle (issue #57, planning #52 Scheibe 2).
//
// The database is the ONLY truth: every read and every write endpoint goes
// through the store modules next to this file. The boot NO LONGER imports
// anything (issue #79 AK6) — a fresh instance simply starts empty, and the
// markdown importer lives on only as the dev/E2E tool `grimoire seed`.
//
// The handle is opened LAZILY rather than at module import, so that importing
// the app for in-process tests stays free of side effects (no database file
// appearing next to the repository). The first access opens the file, runs the
// schema migrator (client.ts), then the job cleanup of issue #23 and the
// reference backfill; every later call gets the memoized handle.

import { getDbFile } from "../config";
import { openDb, type GrimoireDb, type OpenDb } from "../db/client";
import { failInterruptedJobs } from "../db/job-boot";
import { backfillReferences } from "./ref-backfill";

/** What `initStore` was called with — reported on boot. */
export interface StoreInfo {
  /** The database file (or `:memory:`). */
  file: string;
  /** Which SQLite backend the driver picked. */
  backend: string;
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
 * Open the database and apply the schema migrations. Idempotent: a second
 * call returns the same handle, and concurrent first calls share one open.
 *
 * `file` defaults to `GRIMOIRE_DATA/grimoire.db`. Nothing is imported here —
 * an empty database stays empty (issue #79 AK6); tests pass `:memory:` and
 * seed themselves through the importer when they need content.
 */
export async function initStore(options: { file?: string } = {}): Promise<GrimoireDb> {
  if (opened !== null) return opened.db;
  if (opening !== null) return opening;
  const file = options.file ?? getDbFile();
  opening = (async () => {
    const handle = await openDb(file);
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
