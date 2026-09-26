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
- **A row may exist before its content only where a proposal references
  it.** An entity that a generator proposal can reference before it has
  content may exist as a row carrying only its id. Creating
  that id, or applying a proposal for it, fills such a row instead of
  colliding; a row with content is a conflict. Every other entity has no
  empty state: it is created with its content.
- **ids are immutable.** The id is set on creation and never changes; the
  DM can choose it only then, in the create dialog.

## Why

A rule that only the API enforces holds only where someone thought of it. A
wrong value from the generator or a direct write would land in the column
and be shown verbatim afterwards. The row is the truth (`decisions/sqlite`),
so a rule about a column belongs in the column.

This does not contradict the rule that the text format degrades
(`decisions/sqlite`): that rule is about reading bodies; closed lists are
about writing columns.

The id is the key of the whole model: it appears in URLs, foreign keys and
`[[id]]` mentions. Renaming it everywhere after the fact would be the most
expensive part of the write layer and is practically never needed; a better
title needs no new id, because `[[id]]` resolves to the current name.

A generator run can name an entity before anything is known about it, for
example a proposed scene that refers to an NPC or a location that does not
exist yet. The reference must be a foreign key, so the referenced row has to
exist, even if it carries nothing but its id; creating or applying that id
later fills it. Entities that nothing references ahead of their content need
no such state, and an empty one would only be an incomplete row.

## Consequences

- No write changes an id; there is no id cascade in the application.
- A new value in a closed list is a migration, a decision about the data
  model, not only a constant change.
- Deleting entities that others reference needs a decision of its own; the
  foreign keys do not cascade deletes. References across campaigns are
  impossible.
