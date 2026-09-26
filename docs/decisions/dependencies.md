# Dependencies instead of building our own

## Decision

For general tasks an established package is brought in, not built in-house —
validation, schemas, date and time, diffs, reading common formats and
whatever else is not specific to Grimoire. What we write ourselves is what
only Grimoire has: the data model, the write rules, the text vocabulary, the
interface.

## Why

What we do not maintain ourselves we need not think about or test. A
hand-written helper for a standard task costs the same every time: edge cases
the package has long known, tests of our own for them, and one more place
that has to be carried along in the next rework. An established package
brings all that, is documented and reviewed by many. The cost of a
dependency — an entry in the lockfile, an occasional update — is smaller than
that of a rebuild of our own.

## Consequences

- A new dependency requires no entry in `docs/decisions/`. Only Bun-only APIs
  still require an entry (`decisions/stack`).
- "Established" means: widespread, maintained, with types. Versions live in
  the lockfile and are raised deliberately; where a package must be pinned
  exactly, the reason is stated at its place (`jsonrepair`,
  `decisions/generator`).
- Applications: `date-fns` for date and time, `zod` for the schema of every
  entity (`decisions/resources`), `intl-messageformat` for plurals and
  interpolation (`decisions/i18n`).
