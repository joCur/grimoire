# The database holds the rules about its columns

## Decision

- **Every stored reference is a foreign key,** scoped to its campaign. A
  reference names a row that exists, and the database guarantees it.
  Referencing a row that does not exist is rejected on the write path with a
  400 that tells the DM to create the row first; nothing is written.
- **Closed value lists are CHECK constraints.** The allowed values are stated
  once, in the entity's schema module, and the storage schema builds its
  constraints from that list. A foreign value is a 400 with its own code, not
  a raw database error.
- **A mention in the text is not a reference.** `[[id]]` in a body is visible
  text; nothing in storage is derived from it, and one without a row is shown
  as text. A relationship that must be data is a field, not parsed text
  (`decisions/data-shape`).
- **An empty row is valid.** A row that carries only its id is a normal row:
  it shows thinly and is filled like any other. Creating an id that exists as
  an empty row fills it instead of colliding; a row with content is a
  conflict.
- **ids are immutable.** The id is set on creation and never changes;
  personalizing it happens once, in the create dialog.

## Why

A rule that only the API enforces holds only where someone thought of it. A
wrong value from the generator or a direct write would land in the column
and be shown verbatim afterwards. The row is the truth (`decisions/sqlite`),
so a rule about a column belongs in the column.

This does not contradict "the format degrades": degrading is a rule for the
reader of text; what is closed is the write path of columns.

The id is the key of the whole model: it appears in URLs, foreign keys and
`[[id]]` mentions. Renaming it everywhere after the fact would be the most
expensive part of the write layer and is practically never needed; a better
title needs no new id, because `[[id]]` resolves to the current name.

Entities often exist as a reference key long before they have content; a
scene names an NPC, and the DM fills it later. That is why creating fills an
empty row.

## Consequences

- No write changes an id; there is no id cascade in the application.
- A new value in a closed list is a migration, a decision about the data
  model, not only a constant change.
- Every error code needs a catalog entry (`decisions/i18n`).
- Deleting entities that others reference needs a decision of its own; the
  foreign keys do not cascade deletes. References across campaigns are
  impossible.
