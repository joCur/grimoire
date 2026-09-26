# Data is fields and rows, never text sections

## Decision

- What code needs as data, for a view, a write path, a check or the
  generator, is a **field** of an entity or a **row of its own**
  (`decisions/resources`), never something extracted from the text of a
  field.
- A row is its columns: no Markdown inside structured rows and no reader
  that parses text back into rows.
- **Fixtures are the shape of the API.** The example campaign lies under
  `fixtures/` as the objects its resources return, one file per entity and
  id, without `rev`. The seed writes them through the store layer; there is
  no importer and no parser. Bodies in the fixtures are never reformatted.

## Why

Extracting data from free text is an agreement with the DM that breaks
silently: reader and writer recognize a heading or a phrase by slightly
different rules, and whatever the DM writes differently drops out or appears
twice. A field has one value that every reader and writer shares.

Nothing in production imports campaign content; a fresh installation creates
its campaign in the UI (`decisions/sqlite`). A seed that runs through a
parser would test the parser instead of the storage, whereas fixtures in the
shape of the API are at the same time the reference for what the API
answers.

## Consequences

- Neither the generator nor any write path branches on the content of a
  body; a structure a prompt suggests for a body is free text.
- The fixtures are the seed for dev, tests and E2E and the reference
  examples of the text format of bodies.
