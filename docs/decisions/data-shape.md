# Data is fields and rows, never text sections

## Decision

What a view, a write path or a check needs as data is a **field** of an
entity or a **row of its own** (`decisions/resources`) — never a section that
is found by the text of its heading. Headings in the text structure it for
the DM; only `## If:`, an element of the renderer (README.md), has a meaning
for the code. In the code of `app/`, `server/` and `shared/`, only `## If:`
looks up a heading by its text.

A row is its columns: no Markdown in the row, no reader that parses text back
into rows, and no skeleton rows that only a text would need (headings,
markers). A pause is a row of a session's pauses and not a log line: pausing
writes no log line.

A migration that introduces such a field or such a row **carries nothing
over** from the text: an existing section stays free text
(`decisions/sqlite`, rule 2).

### Motivation and atmosphere

- `npcs.motivation` and `locations.atmosphere` are columns and thus fields
  (`motivation`, `atmosphere`). NPC card, location card, hover preview and
  reading view read them; a `## Will` or `## Atmosphäre` in the text has no
  influence on them. An `[[id]]` in the value appears as the current name
  when displayed, without being a reference (`decisions/constraints`); without
  a row it stands as text. Search indexes both fields with resolved names.
- They are edited in the edit mode of the reading view next to the text, not
  in the properties dialog. They share the row's one guard
  (`decisions/writes`).
- The generator delivers both fields via the response schema, nullable like
  `voice` and `appearance`; the NPC and location prompts describe them as
  fields.

### The threads of a chapter

- A thread is a row of the `threads` table and never a checklist in the
  chapter text: `campaign_id`, an opaque `id` (unique per campaign, not per
  chapter and not the position), the chapter `chapter_id` as a foreign key,
  `text`, `done`, `pos`. A thread lies flat under the campaign, its chapter is
  a field, and it has its own `rev`. A further anchor (scene, campaign) would
  be a further owner column.
- Creating carries no `rev`, like idea and log line: appending overwrites
  nothing, and a guard would refuse „Handlungsstrang übernehmen" (adopt plot
  thread) merely because something moved in another tab.
- **Separate guards:** no write to a thread touches the chapter's text or
  `rev`, and a chapter write moves no thread.
- „Handlungsstrang übernehmen" in the post-session review creates a thread in
  the active chapter; the chapter overview shows the threads below the chapter
  text, in order of creation, and maintains them (create, check off,
  rephrase, delete).
- Threads are not indexed, like ideas, and reach no generator prompt; a scene
  run knows only the chapter's id.
- A section `## Offene Fäden` (open threads) in the chapter text is free text.

### Chapter and campaign show their whole text

- The chapter overview shows the **whole text** of the chapter, its header
  below the short description the whole text of the campaign — both through
  the same renderer as every text (callouts, `## If:`, `[[id]]`), limited to a
  few lines and expandable. Whether the text is longer is measured; „Mehr
  anzeigen" (show more) appears only then. Nothing is selected, and no heading
  has a meaning for the display.
- „Kapitel anlegen" (create chapter) writes the description from the dialog as
  the chapter's `body` (`POST …/chapters { title, id?, status?, body? }`), as
  it was typed — trimmed, with a trailing line break, without a heading in
  front.
- A chapter with `## Ziel des Kapitels` (goal of the chapter) shows this
  heading as part of its text.

### Fixtures are the shape of the API

There is exactly one fixture format, and it is the shape of the API: the
example campaign lies under `fixtures/` as the objects its resources return,
one file per entity and id under `fixtures/<campaign>/<resource>/<id>.json`
(for example `fixtures/beispiel/locations/leuchtturm.json`), each without
`rev`. Sessions (with pauses, log lines and played scenes), ideas and
glossary terms are also structured, not text. Every example scene names its
location itself. `grimoire seed <dir>` reads them and writes them through the
store layer. There is no importer. The bodies stay character for character
as they are; their format is a contract.

## Why

A section that code finds by the text of its `##` heading is an agreement
with the DM that breaks silently: reader and writer easily recognize headings
by different rules (case, CRLF), and whatever the DM writes differently
silently drops out or comes into being twice. Storage derives nothing from
text (`decisions/constraints`); the same holds for display, write paths and
checks. Cutting a value out of a Markdown section during a migration would be
exactly the reader this decision rules out.

No production path imports, and whoever installs the app fresh creates their
campaign in the UI. A seed that runs through a parser would test the parser
instead of the storage; fixtures in the shape of the API are at the same time
the reference for what the API answers.

## Consequences

- No generator check and no NPC creation branches on a heading
  (`decisions/generator`, `decisions/constraints`). `## Weiß` (knows) and
  `## Beziehungen` (relationships) are recommendations of the NPC prompts,
  free text; so is a section `## Notizen` (notes).
- The fixtures are the seed for dev, tests and E2E and the reference for
  callouts.
