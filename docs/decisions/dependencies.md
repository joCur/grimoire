# Dependencies instead of building our own

## Decision

For general tasks an established package is brought in, not built in-house:
validation, schemas, date and time, diffs, parsing common formats and
whatever else is not specific to Grimoire. What we write ourselves is what
only Grimoire has: the data model, the write rules, the text vocabulary, the
interface.

## Why

A hand-written helper for a standard task costs the same every time: edge
cases the package has long handled, tests of our own for them, and one more
place to carry along in the next rework. An established package is
documented and reviewed by many. The cost of a dependency, a lockfile entry
and an occasional update, is smaller than that of a rebuild.

## Consequences

- A new dependency requires no decision entry; only Bun-only APIs do
  (`decisions/stack`).
- "Established" means widespread, maintained and typed. Versions live in the
  lockfile and are raised deliberately; where a package must be pinned
  exactly, the reason is stated where it is used.
