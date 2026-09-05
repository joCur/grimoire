// The SQLite driver layer — the ONE file that knows which runtime we are on.
//
// WHY THIS FILE EXISTS (deviation from planning #52 Fassung 3, section 1,
// recorded in ADR #13):
//
// The planning assumed `node:sqlite` is available on Bun as well ("Bun
// ≥1.1.14, Node ≥22.5") and that drizzle ships a `drizzle-orm/node-sqlite`
// driver. Neither holds:
//
//   * Bun (verified on 1.3.14, the version CI pins) does NOT implement
//     `node:sqlite` — `require("node:sqlite")` throws "No such built-in
//     module". Bun's own docs point at `bun:sqlite` instead.
//   * drizzle-orm 0.45.2 (current stable) has no `node-sqlite` driver at all;
//     its sqlite drivers are `bun-sqlite`, `better-sqlite3`, `sqlite-proxy`
//     and the mobile ones.
//
// So the portability rule of CLAUDE.md / DECISIONS #7 ("no Bun-only runtime
// API without an entry in DECISIONS") is honoured the only way it can be:
//
//   * `node:sqlite` is the PRIMARY backend and the one the production Node
//     path uses. The server therefore runs on plain Node with zero native
//     dependencies.
//   * `bun:sqlite` is the BUN-ONLY FALLBACK, used exactly when `node:sqlite`
//     is missing. This is the documented Bun coupling ADR #13 registers —
//     the same shape as the `better-sqlite3` fallback the planning had
//     foreseen for the opposite direction.
//
// Both backends are wrapped into ONE interface (`SqliteClient`) with
// identical parameter and row handling, and `test/db-smoke.test.ts` proves
// FTS5, transactions and UPSERT behave the same on both runtimes (issue #54
// AK5). If either backend ever drifts, that test is the early warning.
//
// The interface is deliberately the surface drizzle's portable
// `drizzle-orm/bun-sqlite/session` needs — that session module only
// duck-types its client and, unlike the driver entrypoint next to it, imports
// nothing runtime-specific. See client.ts.

/** One bound parameter value SQLite can store. */
export type SqlParam = string | number | bigint | null | Uint8Array;

/** Anything we accept from callers before normalization. */
type LooseParam = SqlParam | boolean | undefined;

export interface SqliteStatement {
  run(...params: SqlParam[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  all(...params: SqlParam[]): Record<string, unknown>[];
  /** Rows as positional arrays — what drizzle uses for mapped selects. */
  values(...params: SqlParam[]): unknown[][];
}

/**
 * A `db.transaction(fn)`-style handle. The shape mirrors better-sqlite3 (and
 * therefore bun:sqlite): calling the returned object's `deferred`/
 * `immediate`/`exclusive` method runs `fn` inside a transaction of that kind.
 */
export interface SqliteTransactionRunner {
  deferred(): void;
  immediate(): void;
  exclusive(): void;
}

export interface SqliteClient {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  transaction(fn: () => void): SqliteTransactionRunner;
  close(): void;
  /** Which backend is in use — reported by the smoke test and on boot. */
  readonly backend: "node:sqlite" | "bun:sqlite";
}

/**
 * Normalize one parameter so both backends see the same value:
 * `undefined` → NULL (a missing optional field is a NULL, not an error) and
 * `boolean` → 0/1 (node:sqlite rejects booleans outright, bun:sqlite accepts
 * them — without this the two runtimes would disagree).
 */
function normalizeParam(value: LooseParam): SqlParam {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function normalizeParams(params: LooseParam[]): SqlParam[] {
  return params.map(normalizeParam);
}

/** Plain object copy — node:sqlite hands out null-prototype rows. */
function plainRow(row: unknown): Record<string, unknown> {
  return Object.assign({}, row as Record<string, unknown>);
}

// --- node:sqlite (primary) ---------------------------------------------------

/** Minimal structural type of `node:sqlite`, so this file needs no @types. */
interface NodeStatement {
  run(...params: SqlParam[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  all(...params: SqlParam[]): unknown[];
  setReturnArrays(enabled: boolean): void;
}
interface NodeDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
  close(): void;
}

function nodeClient(db: NodeDatabase): SqliteClient {
  return {
    backend: "node:sqlite",
    exec: (sql) => db.exec(sql),
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        run: (...params) => stmt.run(...normalizeParams(params)),
        all: (...params) => stmt.all(...normalizeParams(params)).map(plainRow),
        values(...params) {
          // node:sqlite's equivalent of better-sqlite3's `.raw()`. The flag is
          // sticky on the statement, so it is turned off again immediately —
          // the same prepared statement is reused for `all()` too.
          stmt.setReturnArrays(true);
          try {
            return stmt.all(...normalizeParams(params)) as unknown[][];
          } finally {
            stmt.setReturnArrays(false);
          }
        },
      };
    },
    transaction(fn) {
      // node:sqlite has no transaction helper — BEGIN/COMMIT/ROLLBACK by hand
      // is the whole of it. Nested calls never reach here: drizzle's session
      // uses SAVEPOINTs for those.
      const run = (mode: string) => {
        db.exec(`BEGIN ${mode}`);
        try {
          fn();
          db.exec("COMMIT");
        } catch (err) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // A failed ROLLBACK means the transaction was already gone (e.g.
            // SQLITE_FULL rolled it back itself). The original error is the
            // interesting one, so it wins.
          }
          throw err;
        }
      };
      return {
        deferred: () => run("DEFERRED"),
        immediate: () => run("IMMEDIATE"),
        exclusive: () => run("EXCLUSIVE"),
      };
    },
    close: () => db.close(),
  };
}

// --- bun:sqlite (Bun-only fallback) -----------------------------------------

interface BunStatement {
  run(...params: SqlParam[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  all(...params: SqlParam[]): unknown[];
  values(...params: SqlParam[]): unknown[][];
}
interface BunDatabase {
  exec(sql: string): void;
  prepare(sql: string): BunStatement;
  close(): void;
}

function bunClient(db: BunDatabase): SqliteClient {
  return {
    backend: "bun:sqlite",
    exec: (sql) => db.exec(sql),
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        run: (...params) => stmt.run(...normalizeParams(params)),
        all: (...params) => stmt.all(...normalizeParams(params)).map(plainRow),
        values: (...params) => stmt.values(...normalizeParams(params)),
      };
    },
    transaction(fn) {
      // Hand-rolled here as well, on purpose: bun:sqlite's own
      // `db.transaction()` would work, but a single implementation means the
      // two runtimes cannot drift in rollback behaviour.
      const run = (mode: string) => {
        db.exec(`BEGIN ${mode}`);
        try {
          fn();
          db.exec("COMMIT");
        } catch (err) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // see nodeClient
          }
          throw err;
        }
      };
      return {
        deferred: () => run("DEFERRED"),
        immediate: () => run("IMMEDIATE"),
        exclusive: () => run("EXCLUSIVE"),
      };
    },
    close: () => db.close(),
  };
}

// --- backend selection -------------------------------------------------------

/**
 * Open a SQLite database file (or `:memory:`), preferring `node:sqlite`.
 *
 * Both imports are dynamic because a static one would break the OTHER
 * runtime at module-load time: `node:sqlite` does not exist on Bun, and
 * `bun:sqlite` is not resolvable by Node's ESM loader at all.
 */
export async function openSqlite(filename: string): Promise<SqliteClient> {
  try {
    const { DatabaseSync } = (await import("node:sqlite")) as unknown as {
      DatabaseSync: new (path: string) => NodeDatabase;
    };
    return nodeClient(new DatabaseSync(filename));
  } catch {
    // No node:sqlite — this is Bun (or a Node older than 22.5).
  }
  try {
    const { Database } = (await import(/* @vite-ignore */ "bun:sqlite")) as unknown as {
      Database: new (path: string) => BunDatabase;
    };
    return bunClient(new Database(filename));
  } catch {
    // fall through to the error below
  }
  throw new Error(
    "No SQLite backend available: this runtime provides neither node:sqlite " +
      "(Node >= 22.5) nor bun:sqlite. See ADR #13 in docs/DECISIONS.md.",
  );
}
