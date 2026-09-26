# SQLite is the source of truth

## Decision

One SQLite database in `GRIMOIRE_DATA` is the **sole** source of truth for
campaign content. There is no mirror to the file system, no auto-export and
no two-way sync.

- **Markdown is the content format of bodies** and nothing else in storage.
  The body vocabulary in README.md is normative, and the format degrades
  instead of validating: unknown constructs render as plain text, never as an
  error.
- **A fresh instance starts empty.** The server reads no campaign files; a
  real campaign is created in the UI. A seed tool that writes the fixtures
  through the store layer exists for dev, tests and E2E only
  (`decisions/data-shape`).
- **Backing up the database file is the stack owner's job**
  ([docs/DEPLOYMENT.md](../DEPLOYMENT.md)); a backup system is not a feature.
- **Search is an FTS5 index** in the same database, maintained explicitly by
  the store layer.

### Schema and migrations

- The ORM is Drizzle; `server/src/db/schema.ts` is the one source of the
  storage shape.
- Migrations are generated, committed SQL files, applied at boot in one
  transaction. A committed migration is never edited.
- The chain starts with a baseline of the first supported version; older
  databases are not recognized or converted. Downgrade is not supported: the
  way back is a backup plus an older release (`decisions/release`).
- **Data changes live in the migration itself,** as its SQL, in the same
  transaction as the schema change. There is no data step, preflight check or
  boot pass beside the migrator.
- **What cannot be carried over unambiguously, the migration decides fixedly
  and losslessly** (for example clearing a value, or keeping it visibly in
  the text) instead of guessing.
- **No transition code.** A rework is cut so that neither adapters nor
  duplicate paths arise.
- Migrations are not tested; the behavior they enable is.

## Why

Content is maintained in the app (`decisions/writes`), so the truth belongs
behind its API. A mirror of or sync with files creates a whole class of
conflict problems.

A baseline instead of a long chain keeps new instances simple, and code that
lifts older states would have no use case but maintenance cost. For the same
reason every data change lives in the migration: a data step beside it is
transition code that stays. Invalid data cannot arise in the first place
(`decisions/constraints`), so no preflight is needed.

## Consequences

- No code reads campaign content from anywhere but the database.
- Not part of the decision: export/import, typo-tolerant search,
  auto-backups, multi-user operation.
