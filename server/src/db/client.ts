// Opening the Grimoire database: driver, PRAGMAs, schema migrations.
//
// Everything above this file talks to the returned drizzle handle and never
// to a SQLite API — the runtime split lives in ./driver.ts alone.
//
// A note on how the drizzle handle is built: drizzle 0.45 has no
// `node-sqlite` driver, and the two entrypoints that would fit
// (`drizzle-orm/bun-sqlite`, `drizzle-orm/better-sqlite3`) each import their
// own client package at module load, which breaks the other runtime. The
// SESSION module next to them (`drizzle-orm/bun-sqlite/session`) imports
// nothing runtime-specific and only duck-types its client, so the twenty
// lines of `construct()` from that driver are reproduced here against our own
// `SqliteClient`. Same dialect, same session, same migrator — the only thing
// that changes is who opens the file. See ADR #13.

import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { BaseSQLiteDatabase, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { SQLiteBunSession } from "drizzle-orm/bun-sqlite/session";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { openSqlite, type SqliteClient } from "./driver";
import { schema } from "./schema";

/** The drizzle handle the whole server uses. Synchronous, like the driver. */
export type GrimoireDb = BaseSQLiteDatabase<"sync", unknown, typeof schema>;

/** An open database plus the raw client (needed for PRAGMAs and closing). */
export interface OpenDb {
  db: GrimoireDb;
  client: SqliteClient;
  close(): void;
}

/** Directory of the committed migration SQL files. */
export const MIGRATIONS_DIR = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "migrations",
);

/**
 * PRAGMAs, applied to every connection (planning section 5):
 *
 *   journal_mode=WAL   — readers never block the writer. WAL is a per-DATABASE
 *                        setting and persists in the file, but it is set on
 *                        every open anyway so a database created elsewhere is
 *                        pulled into WAL too. See docs/DEPLOYMENT.md for the
 *                        bind-mount caveat.
 *   foreign_keys=ON    — per-CONNECTION and OFF by default in SQLite, so this
 *                        one genuinely has to be repeated. Without it the
 *                        cascades in schema.ts are decoration.
 *   busy_timeout=5000  — the generator writes from a job while a request
 *                        reads; five seconds of waiting beats an SQLITE_BUSY.
 */
function applyPragmas(client: SqliteClient): void {
  client.exec("PRAGMA journal_mode = WAL");
  client.exec("PRAGMA foreign_keys = ON");
  client.exec("PRAGMA busy_timeout = 5000");
}

/** Build the drizzle handle over our client (see the note at the top). */
function buildDrizzle(client: SqliteClient): GrimoireDb {
  const dialect = new SQLiteSyncDialect();
  const session = new SQLiteBunSession(client as never, dialect, undefined, {});
  return new BaseSQLiteDatabase("sync", dialect, session, undefined) as GrimoireDb;
}

/**
 * Apply the committed migrations. Drizzle's own `migrate()` helpers are
 * runtime-specific wrappers around exactly these two calls; the dialect
 * wraps the whole run in a transaction and keeps its bookkeeping in
 * `__drizzle_migrations`.
 */
export function migrateDb(db: GrimoireDb, migrationsFolder = MIGRATIONS_DIR): void {
  const migrations = readMigrationFiles({ migrationsFolder });
  const target = db as unknown as {
    dialect: SQLiteSyncDialect;
    session: unknown;
  };
  target.dialect.migrate(migrations, target.session as never, { migrationsFolder });
}

/**
 * Open the database at `filename`, apply the PRAGMAs and run the migrations.
 * `:memory:` is allowed and is what the tests use.
 *
 * The parent directory is created when missing — a fresh volume has no
 * `data/` yet, and failing the boot over a missing directory would be a
 * pointless first-run papercut.
 */
export async function openDb(filename: string): Promise<OpenDb> {
  if (filename !== ":memory:") {
    mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }
  const client = await openSqlite(filename);
  applyPragmas(client);
  const db = buildDrizzle(client);
  migrateDb(db);
  return { db, client, close: () => client.close() };
}

/**
 * True when the database holds no campaign data at all. This is the
 * defensive half of the migration's idempotency rule (planning section 3):
 * a NON-EMPTY database is never overwritten, marker or no marker.
 *
 * "Empty" is deliberately narrow — only `campaigns`. The migration
 * bookkeeping tables (`meta`, `migration_report`) say nothing about whether
 * a DM's content is in there.
 */
export function isDbEmpty(db: GrimoireDb): boolean {
  const rows = db.all<{ n: number }>(sql`select count(*) as n from campaigns`);
  return Number(rows[0]?.n ?? 0) === 0;
}
