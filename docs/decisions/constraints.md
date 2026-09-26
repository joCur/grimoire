# The database holds the rules about its columns

## Decision

### Every reference is a foreign key

Every stored reference has a composite foreign key
`(campaign_id, <reference>)` with `ON UPDATE CASCADE` and
`ON DELETE NO ACTION`. A reference thus names a row that exists, and the
database guarantees it.

| Reference | Target | Required |
| --------- | ------ | -------- |
| `scenes.chapter_id` | `chapters` | yes — a scene belongs to a chapter |
| `scenes.location` | `locations` | no |
| `scene_npcs.npc_id` | `npcs` | yes |
| `npcs.chapter_id` | `chapters` | no |
| `locations.chapter_id` | `chapters` | no |
| `threads.chapter_id` | `chapters` | yes |
| `log_entries.scene_id` | `scenes` | no |
| `played_scenes.scene_id` | `scenes` | yes |

`generate_jobs.chapter` has no foreign key: a run with „Neues Kapitel" (new
chapter) names the chapter that it creates itself when applied
(`decisions/generator`).

**Naming creates nothing.** A row comes into being through its create
endpoint (which includes „NPC anlegen" (create NPC) from a log line in the
post-session review) and through applying a generator proposal, nowhere
else — and that includes the chapter of a „Neues Kapitel" run. An applied
scene takes along the proposed NPCs and locations of the same run that it
names: they are part of the same proposal. What the DM has rejected stays
rejected; then the scene is refused and names the missing row.

Whoever names something in `npcs`, `location` or `chapter`, in a log line or
in a played scene that has no row gets a 400 with its own code
(`npc_unknown`, `location_unknown`, `chapter_unknown`,
`log_scene_unknown`, `played_scene_unknown`) and the hint to create the row
first; nothing is written. The location of a scene is a location id or
empty; free text is 400 `location_not_an_id`.

**A mention in the text is not a reference.** `[[id]]` and the lines under
`## Beziehungen` (relationships) are visible text. There is no table for
relationships, because nothing in storage is derived from text; a
relationship as data would be a field in the dialog and in the generator, not
a parsed section (`decisions/data-shape`). An `[[id]]` without a row is shown
as text, without an error.

### An empty row is not an error

A row without content, such as an NPC that carries only its id, shows a thin
card, can be filled normally and gets no „fehlt" (missing) placeholder.
Applying a generator proposal fills an empty NPC or location; one with
content is a conflict.

An NPC is empty when all its fields are at their default
(`isEmptyNpcRow` in `server/src/store/npcs.ts`); a `status` other than the
default counts as content. Creating or applying the same id fills an empty
NPC instead of colliding. An NPC with content is 409 `slug_taken` with a free
suggestion, and nothing is written. The text of an NPC created from a log
line is exactly the note, without a heading; without a note it stays empty.

### Status and type are CHECK constraints

The four closed fields — `scenes.status`, `scenes.type`, `npcs.status`,
`chapters.status` — are `CHECK` constraints on their columns. The allowed
values are stated **once**, in the modules of their entity (`SCENE_STATUSES`
and `SCENE_TYPES` in `shared/src/scene.ts`, `NPC_STATUSES` in
`shared/src/npc.ts`, `CHAPTER_STATUSES` in `shared/src/chapter.ts`); the
schema builds the constraints from exactly these lists. A foreign value on
the write path is 400 `status_not_allowed` (`{ kind, value, allowed }`) or
`scene_type_not_allowed` (`{ value, allowed }`), not a
`CHECK constraint failed` from SQLite.

The timestamps of a session and its pauses have exactly one form,
`yyyy-mm-ddTHH:MM:SS` as zoneless local time (`server/src/store/time.ts`).
The server derives them from the epoch value the client writes
(`decisions/resources`), and the reader reads only them.

### ids are immutable

The `id` of a row is set on creation and never changes afterwards. The
properties dialog shows it as context but offers no change; no write changes
it. Personalizing the id happens once, in the create dialog.

## Why

A rule that only the API enforces is an agreement: it holds at the places
where someone thought of it. A typo from the generator or from a direct write
would arrive in the column and afterwards be a value that the reading view
shows verbatim and nobody recognizes as an error. The row is the truth
(`decisions/sqlite`), so a rule about the content of a column belongs in the
column — references as foreign keys, closed value lists as CHECK.

"The format degrades" does not contradict this. Degrading is a rule for the
**reader**: an unknown callout and an unknown heading are displayed and never
throw. What is closed is the **write path**.

The id is the reference key of the whole model: it appears in every URL, in
every foreign key and in every `[[id]]` in the text. A mechanism that carries
it along everywhere after the fact would be the most expensive part of the
write layer and would practically never be needed. A better **title** needs
no new id: `[[id]]` always resolves to the current display name.

An NPC often exists as a reference key long before it contains anything; a
scene names it, and the DM fills it later. That is why creating fills the
empty row instead of failing on it.

## Consequences

- There is no endpoint that changes an id, no reference cascade and no usage
  report. The `ON UPDATE CASCADE` foreign keys stay in the schema: they keep
  child rows honest and cost nothing.
- Display names can be changed freely; the search index updates the
  referring rows along with it (`server/src/store/refs.ts`).
- A new value in one of the value lists is a migration, not a change to a
  constant alone: a fifth status position is a decision about the data model.
- The app needs a catalog entry for every error code; without one it degrades
  to the English `error` sentence (`decisions/i18n`).
- Not part of the decision: a delete path for chapters, scenes, NPCs and
  locations (there is none; `ON DELETE NO ACTION` only says that such a path
  needs a decision of its own) and references between campaigns (the foreign
  keys rule them out, because `campaign_id` is part of every reference).
