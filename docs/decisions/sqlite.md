# SQLite is the source of truth

## Decision

One SQLite database is the **sole** source of truth for campaign content:
`GRIMOIRE_DATA/grimoire.db`. There is no mirror to the file system, no
auto-export and no two-way sync.

- **Markdown is the content format of the `body` columns** — and nothing else
  in storage. The body vocabulary from README.md (callouts, `## If:`,
  hashtags) is normative, and the format degrades instead of validating:
  unknown callouts and headings are plain text, never an error.
- **A body is a Markdown field** and editable as Markdown in the UI.
  "Blocks as rows" is an option left open; the schema does not rule it out.
- **The glossary is a structured table** (term → explanation), not a
  Markdown blob.
- **The server reads no campaign files.** A fresh instance starts **empty**:
  boot opens the database, sets the PRAGMAs, applies the schema migrations and
  reports interrupted generator jobs as failed (`decisions/generator`),
  nothing else. The cold start of a real campaign happens in the UI.
- **`grimoire seed <dir>`** is the dev and E2E tool that writes rows into an
  empty database (`bun run --filter @grimoire/server seed`, report on
  stdout). It loads the JSON fixtures through the store layer
  (`decisions/data-shape`). Apart from it, only the app writes.
- **`GRIMOIRE_DATA`** (default `./data`) holds `grimoire.db` together with
  `-wal`/`-shm` — the only data setting there is.
- **PRAGMAs:** `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- **Backing up the DB file is the stack owner's job** (volume backup, note in
  [docs/DEPLOYMENT.md](../DEPLOYMENT.md)); a backup system of our own is not a
  feature.
- **Driver:** `node:sqlite` or `bun:sqlite` behind `server/src/db/driver.ts`,
  the one registered Bun coupling (`decisions/stack`).

### Drizzle and migrations

- **The ORM is Drizzle** (`drizzle-orm`, `drizzle-kit` as a dev dependency).
  `server/src/db/schema.ts` is the one source of the storage shape.
- **Migrations are generated, committed SQL files** under
  `server/src/db/migrations/` and are applied at boot in one transaction. New
  migrations are created via `drizzle-kit generate`.
- **Downgrade is not supported.** The way back is the volume backup plus an
  image rollback to an older version tag (`decisions/release`).
- **The chain starts with a baseline,** `0000_baseline.sql`, the schema of
  v0.7. v0.7 is the first supported version; the server does not recognize an
  older database and does not treat it specially — there is no version lock.
  Drizzle's migrator applies a migration only if its `when` in the journal is
  greater than the `created_at` of the last recorded one, and compares no
  hashes. That is why the `when` values of `0000_baseline` (`1789757329900`)
  and `0001_scene_pos_per_chapter` (`1789760000000`) never change.
- **Migrations are not tested.** What is tested is the behavior they enable —
  such as the constraint error on the write path — not their SQL.

### Rules for every migration

1. **Data changes live in the migration itself.** Moves, reformatting and
   splits are the migration's SQL and run in the same transaction as the
   schema change. There is no data step before or after the migrator, no
   preflight check and no boot pass.
2. **Whatever cannot be carried over unambiguously, the migration decides
   fixedly and losslessly** — for example setting `NULL`, carrying the value
   visibly into the text, or appending it as a section of its own. The
   migration decides traceably and documented instead of silently guessing;
   the decision lives in the file under `docs/decisions/` that the change
   concerns.
3. **No code that exists only for a migration.** There is no transition code:
   a rework is cut so that neither adapters nor duplicate paths arise.
4. **Invalid data never comes into being.** CHECK constraints, foreign keys
   and the 400 on the write path ensure that (`decisions/constraints`). That
   is why no preflight check is needed.

### Search

**FTS5** is the search index, created as a hand-written custom migration
(tokenizer `unicode61 remove_diacritics 2`, ranking
`bm25(search_fts, 10, 6, 4, 1)`) and maintained explicitly from the store
layer.

## Why

Content is maintained in the app (`decisions/writes`), so the truth belongs
behind its API. A mirror of or sync with files creates a whole class of
conflict problems; it is not built.

A baseline instead of a long chain keeps new instances simple: they need only
the final state, and code that lifts older states over a threshold would have
no use case but maintenance cost. For the same reason every data change lives
in the migration: a data step beside it is transition code that stays.

## Consequences

- No code reads campaign content from anywhere other than the database.
- Not part of the decision: export/import, a trigram tokenizer for
  typo-tolerant search, auto-backups and multi-user operation
  (`decisions/scope`).
