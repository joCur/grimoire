# Decisions

Grimoire's architecture decisions, one file per topic. They are binding; a
deviation requires a changed or new file.

## What a decision is

- A decision is a deliberate choice between alternatives with lasting
  validity: the principle, why it was chosen (and what was rejected), and its
  consequences as principles.
- It stays true without edits when the code grows. A new table, endpoint,
  error code or renamed function never requires touching a decision.
- It holds no inventories (lists of tables, columns, foreign keys, endpoints,
  error codes, settings, files or functions) and no implementation detail
  that the code, the schema or the route comments document. A concrete
  example appears only where the principle is unintelligible without it, and
  then generically. Pointing to where details live is fine.
- It records only what holds: nothing from older versions, no transitional
  behavior, no temporary decisions and no intermediate states. The
  intermediate state of a rework cut into slices lives only in the ticket;
  the history of a decision lives in git.

## How decisions are kept

- Decisions are written in English (`decisions/language`).
- Each file has a descriptive name, no number and no date, and is structured
  into `## Decision`, `## Why` and `## Consequences`.
- A change rewrites the affected file or creates a new one. A rule lives in
  exactly one file; where it touches another topic, the other file refers to
  it.
- Code comments cite a decision as `decisions/<name>`, documents as a link to
  `docs/decisions/<name>.md`.

## Files

- [scope.md](scope.md) — single-user tool for the DM: no VTT, no wiki, no
  player view, no tabletop sync, access control in front of the app.
- [stack.md](stack.md) — tech stack, workspace monorepo, Node portability and
  the register of Bun-only APIs.
- [dependencies.md](dependencies.md) — established packages instead of
  building our own.
- [language.md](language.md) — the repository is written in English; German
  only in the German UI catalog; the scout rule.
- [testing.md](testing.md) — tests never depend on UI text; they use roles,
  test ids or catalog keys and assert on behavior and data.
- [sqlite.md](sqlite.md) — one SQLite database is the source of truth;
  Markdown bodies, empty start, migrations.
- [constraints.md](constraints.md) — the database enforces references and
  closed value lists; referenced-before-filled rows; ids are immutable.
- [resources.md](resources.md) — one resource, one type, one zod schema per
  entity; URLs, keys, nesting, app slices.
- [writes.md](writes.md) — app-first, one guard per row, one write path per
  entity, conflicts carry the current state.
- [data-shape.md](data-shape.md) — data is fields and rows, never text
  sections; fixtures in the shape of the API.
- [scene-order.md](scene-order.md) — one active chapter, one source for the
  location, the DM's scene order with its own guard.
- [generator.md](generator.md) — LLM generator: review before writing,
  schema-enforced responses, server-side jobs, pipeline of parts.
- [polling.md](polling.md) — client refresh via a version counter.
- [i18n.md](i18n.md) — typed catalog, ICU messages, language-free server.
- [release.md](release.md) — release-please, Conventional Commits, version
  tags, `:latest` only on release, CI never publishes.
