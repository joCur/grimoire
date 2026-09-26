# Data is fields and rows, never text sections

## Decision

- What a view, a write path or a check needs as data is a **field** of an
  entity or a **row of its own** (`decisions/resources`), never a section of
  a body found by the text of its heading. Headings structure the text for
  the DM; only the renderer's own vocabulary (README.md) has meaning for the
  code.
- A row is its columns: no Markdown inside structured rows, no reader that
  parses text back into rows, and no rows that exist only to shape a text.
- A migration that introduces such a field or row **carries nothing over**
  from existing text; the old section stays free text (`decisions/sqlite`).
- **Fixtures are the shape of the API.** The example campaign lies under
  `fixtures/` as the objects its resources return, one file per entity and
  id, without `rev`. The seed writes them through the store layer; there is
  no importer and no parser. Bodies in the fixtures are never reformatted;
  their format is a contract.

## Why

A section that code finds by its heading is an agreement with the DM that
breaks silently: reader and writer recognize headings by slightly different
rules, and whatever the DM writes differently drops out or appears twice.
Storage derives nothing from text (`decisions/constraints`), and the same
holds for display, write paths and checks. Cutting a value out of a section
during a migration would be exactly such a reader.

No production path imports; a fresh installation creates its campaign in the
UI. A seed that runs through a parser would test the parser instead of the
storage, whereas fixtures in the shape of the API are at the same time the
reference for what the API answers.

## Consequences

- Neither the generator nor any write path branches on a heading; headings a
  prompt recommends are free text.
- The fixtures are the seed for dev, tests and E2E and the reference for the
  body vocabulary.
