# Decisions

Grimoire's architecture decisions, one file per topic. They are binding; a
deviation requires a changed or new file.

## How decisions are kept

- Decisions are written in English.
- A file records only target decisions: what holds today. There are no
  temporary decisions and no intermediate states; the intermediate state of a
  rework cut into slices lives only in the ticket.
- Each file has a descriptive name, no number and no date, and is structured
  into `## Decision`, `## Why` and `## Consequences`.
- A change rewrites the affected file or creates a new one. A rule lives in
  exactly one file; where it touches another topic, the other file refers to
  it.
- The history of a decision lives in git, not in the file.
- Code comments cite a decision as `decisions/<name>`, documents as a link to
  `docs/decisions/<name>.md`.

## Files

- [scope.md](scope.md) — single-user tool for the DM: no VTT, no wiki, no
  player view, no Roll20 sync, access control in front of the app.
- [stack.md](stack.md) — tech stack, Bun workspace monorepo with `shared/`,
  Node portability and the one registered Bun-only API, growth path.
- [dependencies.md](dependencies.md) — established packages instead of
  building our own.
- [sqlite.md](sqlite.md) — one SQLite file is the source of truth: Markdown
  as the body format, Drizzle, migrations from the baseline, FTS5,
  `GRIMOIRE_DATA`, seed tool.
- [constraints.md](constraints.md) — references as foreign keys, status and
  type as CHECK, immutable ids, empty rows.
- [resources.md](resources.md) — one resource, one type, one zod module per
  entity; URL scheme, children of a session, orders, app slices.
- [writes.md](writes.md) — app-first, guard `rev`, 409 with the current state,
  one write path per entity, `force`.
- [data-shape.md](data-shape.md) — data is fields and rows, never text
  sections; threads; fixtures in the shape of the API.
- [scene-order.md](scene-order.md) — chapter status and one active chapter,
  the location of a scene, the scene order with its own guard.
- [generator.md](generator.md) — LLM generator: provider, response schema,
  server-side jobs, pipeline of parts, review state on the job, applying.
- [polling.md](polling.md) — client refresh via the version counter.
- [i18n.md](i18n.md) — typed catalog, ICU via `intl-messageformat`,
  language-free server, lint gate.
- [release.md](release.md) — release-please, Conventional Commits, version
  tags, `:latest` only on release, CI never publishes.
