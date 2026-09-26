# Tests never depend on UI text

## Decision

Tests never assert against UI text and never locate elements by it, in any
language. They find elements by role and accessible structure, by stable
test ids, or through catalog keys, and they assert on behavior and data:
API responses, rows in the database, and the state the app shows.

## Why

Wording changes freely: copy edits, new translations and rephrased
sentences are routine and must not break tests. A test pinned to a sentence
tests the translation, not the behavior, and fails for a reason that says
nothing about whether the product works. Roles and data describe what the
product does, and they stay stable while its wording evolves.

## Consequences

- A test that matches or locates by UI text violates this decision and is a
  review finding.
- Existing tests that match UI text are converted by the scout rule
  (`decisions/language`): whoever touches such a test file for another
  reason converts the whole file in the same change.
- Where an element has no role or accessible name that identifies it
  reliably, it gets a stable test id rather than a text match.
