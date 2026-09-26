# Grimoire — data model & conventions

Grimoire stores a campaign in an SQLite database
(`GRIMOIRE_DATA/grimoire.db`). Every entity — **campaign**, **chapter**,
**scene**, **NPC**, **location**, **thread** (a plot thread a chapter
carries), **idea**, **glossary term**, **campaign knowledge** (every naming
convention, every fact, every style rule on its own) and the **session**
with its **pauses** and **log lines** — is a row of its own table and its own
resource with its own
fields ([decisions/resources](docs/decisions/resources.md)). Campaign, chapter, scene, NPC and location have among their
fields a `body`: their **text** in Markdown.

The storage shape is stated exactly once, in `server/src/db/schema.ts`; this
README describes what the fields may hold and what the text can contain.
All field names are English (stable, machine-readable), all content is
German.

Ground rule: **the format degrades, it does not validate.** An unknown
heading or an unknown callout in the text is shown as normal text; nothing
breaks.

## Resources

Every entity is its own **resource** with its own type from exactly one zod
schema in `shared/src/<entity>.ts` ([decisions/resources](docs/decisions/resources.md)). The URL names the entity and
its `id`; a response carries all fields of the entity side by side, `body`
included, without `kind`, without `path`:

| Entity | Read/change | Create/list | App route |
| ------ | ----------- | ----------- | --------- |
| Campaign | `GET/PATCH /api/campaigns/<campaign>` | `POST /api/campaigns` | `/campaigns/<campaign>` |
| Chapter | `GET/PATCH /api/campaigns/<campaign>/chapters/<id>` | `GET/POST /api/campaigns/<campaign>/chapters` | `/campaigns/<campaign>/chapters/<id>` |
| Scene | `GET/PATCH /api/campaigns/<campaign>/scenes/<id>` | `GET/POST /api/campaigns/<campaign>/scenes` | `/campaigns/<campaign>/scenes/<id>` |
| NPC | `GET/PATCH /api/campaigns/<campaign>/npcs/<id>` | `GET/POST /api/campaigns/<campaign>/npcs` | `/campaigns/<campaign>/npcs/<id>` |
| Location | `GET/PATCH /api/campaigns/<campaign>/locations/<id>` | `GET/POST /api/campaigns/<campaign>/locations` | `/campaigns/<campaign>/locations/<id>` |
| Thread | `GET/PATCH/DELETE /api/campaigns/<campaign>/threads/<id>` | `GET/POST /api/campaigns/<campaign>/threads` | in the chapter overview `/campaigns/<campaign>` |
| Idea | `GET/PATCH /api/campaigns/<campaign>/ideas/<id>` | `GET/POST /api/campaigns/<campaign>/ideas` | in the debrief and on the mobile start surface |
| Glossary term | `GET/PATCH/DELETE /api/campaigns/<campaign>/glossary-terms/<id>` | `GET/POST /api/campaigns/<campaign>/glossary-terms` | on the glossary page `/campaigns/<campaign>/glossary` |
| Campaign knowledge | `GET/PATCH/DELETE /api/campaigns/<campaign>/knowledge-items/<id>` | `GET/POST /api/campaigns/<campaign>/knowledge-items` | on the knowledge page `/campaigns/<campaign>/knowledge` |
| Session | `GET/PATCH/DELETE /api/campaigns/<campaign>/sessions/<id>` | `GET/POST /api/campaigns/<campaign>/sessions` | `/campaigns/<campaign>/sessions/<id>`, live `/campaigns/<campaign>/live` |
| Pause | `PATCH …/sessions/<session>/pauses/<id>` | `POST …/sessions/<session>/pauses` | in the session |
| Log line | `PATCH …/sessions/<session>/log/<id>` | `POST …/sessions/<session>/log` | in the session and the debrief |

The chapter overview stays `/campaigns/<campaign>`; the list of campaigns
(`GET /api/campaigns`) responds with its own shape, the name next to the
most recent session.

The `id` is derived from the typed name on creation, by exactly one rule
(`@grimoire/shared/slug`), and is fixed from then on: it is the reference
key in URLs, links and `[[id]]` references and never changes afterwards
([decisions/constraints](docs/decisions/constraints.md)). The fields dialog of a location or a chapter shows it
without offering a change; the edit modes of a scene and an NPC have no id
field at all.

The chapter overview is one continuous list of a chapter's scenes in the
**order the DM sets** ([decisions/scene-order](docs/decisions/scene-order.md)); the location appears by its name in the
meta line of each scene — if a scene has none, the location part is simply
missing there —, contingency scenes stand as a block of their own at the
end. This order is **not a field** — it is a statement of the chapter about
its scenes, not of a scene about itself, and therefore appears in no field
table of this document. It is maintained via up/down in the chapter
overview; a new scene lands at the end of its chapter. The scenes of a
generator run keep the order of its outline, even when they are accepted
one by one and out of order ([decisions/scene-order](docs/decisions/scene-order.md)).

The generator gets glossary terms and campaign knowledge as context; both
are maintained on their own pages.

Everything that depends on a campaign hangs under the campaign — in the API
`/api/campaigns/<campaign>/…`, in the app `/campaigns/<campaign>/…` ([decisions/resources](docs/decisions/resources.md)).
Without a campaign stay `/api/campaigns`, `/api/settings` and `/settings`.

## Fields

Whatever a view needs as data is a field of an entity or a row of a list,
never a section found by its heading
([decisions/data-shape](docs/decisions/data-shape.md)).

Every entity is written with `PATCH` on its resource and
`{ rev, force?, …subset of the fields }`: only the named fields change,
`null` clears an optional field, and a field the entity does not know, or a
value of the wrong shape, is a 400 that names the field. A stale `rev` is
409 with the current state of the resource.

### Campaign

The campaign is its own resource with its own type (`Campaign`, from the zod
schema in `shared/src/campaign.ts`, [decisions/resources](docs/decisions/resources.md)). `GET
/api/campaigns/<campaign>` responds with it:

```json
{
  "id": "beispiel",
  "name": "Der Leuchtturm von Salzhafen",
  "description": "Eine Küstenkampagne um einen erloschenen Leuchtturm, …",
  "body": "\nKampagnenweite Notizen: …",
  "glossaryIntro": "",
  "rev": 1
}
```

| Field | Meaning |
| ----- | ------- |
| `id` | stable, the key in every URL |
| `name` | display name in the UI; if missing, the display name is the id |
| `description` | short description, one line; optional |
| `body` | Markdown of the campaign: free note space for campaign-wide matters |
| `glossaryIntro` | Markdown above the glossary terms that belongs to no term; empty if there is none |
| `rev` | row version, the guard of every write |

It is written with `PATCH /api/campaigns/<campaign>` and `{ rev, force?,
…subset of name, description, body, glossaryIntro }` — `null` clears the
description, a stale `rev` is 409 with the current campaign.
`glossaryIntro` is stored like `body`. The order of the campaign knowledge
has its own guard on the campaign (see campaign knowledge); a write to the
campaign does not move it.
`POST /api/campaigns { name, description?, id? }` creates a campaign and
responds with it: the `id` is derived from the name if the request sets
none, and a taken one is a 409 `slug_taken` with a suggestion. The fixture
is the campaign without `rev`.

The header of the chapter overview shows the text below the short
description: whole and rendered, limited to a few lines and expandable.
Without text, nothing is shown there.

### Chapter

A chapter is its own resource with its own type (`Chapter`, from the zod
schema in `shared/src/chapter.ts`, [decisions/resources](docs/decisions/resources.md)). `GET
/api/campaigns/<campaign>/chapters/<id>` responds with it:

```json
{
  "id": "01-salzhafen",
  "title": "Kapitel 1: Der Leuchtturm von Salzhafen",
  "status": "active",
  "body": "Herausfinden, warum das Leuchtfeuer seit drei Nächten erloschen ist.\n",
  "rev": 1
}
```

| Field | Meaning |
| ----- | ------- |
| `id` | stable; the `chapter` field of a scene, an NPC and a location names it |
| `title` | display name; without a title of its own the chapter shows its id |
| `status` | `planned`, `active` or `done`; optional |
| `body` | Markdown of the chapter: what it is about and what the group should achieve |
| `rev` | row version, the guard of every write |

`active` marks the **one** chapter the session view opens: at most one
chapter per campaign is active. It is activated with `PATCH
…/chapters/<id> { rev, status: "active" }` or with `POST …/chapters` and
`status: "active"`; the server sets the previously active chapter to
`planned` in the same operation, and its `rev` moves along. The API writes
only these three values (400 `status_not_allowed` otherwise), and the column
itself admits no other — `status` is a `CHECK` constraint
([decisions/constraints](docs/decisions/constraints.md)), not a degrading free-text field. `null` clears the status.

It is written with `PATCH …/chapters/<id>` and `{ rev, force?, …subset of
title, status, body }`; a stale `rev` is 409 with the current chapter.
Neither the scene order nor a thread of the chapter moves with it — each has
its own guard. `POST …/chapters { title, id?, status?, body? }` creates a
chapter and responds with it: the `id` is derived from the title if the
request sets none, the status is `planned` if it names none, and the chapter
stands at the end of the campaign. The `body` from the create-chapter
dialog becomes the text as it was typed — trimmed, with a trailing line
break, without a heading before it. A taken `id` is a 409 `slug_taken` with
a suggestion. The fixture is the chapter without `rev`; a new-chapter run
creates its chapter as `planned` with the description from its outline as
`body` (see generator).

The chapter overview shows the text below the title, whole and rendered like
any text, limited to a few lines and expandable; whether and which headings
it has changes nothing about that ([decisions/data-shape](docs/decisions/data-shape.md)).

The **threads** — the plot threads the chapter carries — are neither text
nor a field of the chapter, but each is its own resource that names its
chapter (see thread). A `## Offene Fäden` in the text of an older chapter
stays free text; nothing reads it as a thread.

### Scene

A scene is its own resource with its own type (`Scene`, from the zod schema
in `shared/src/scene.ts`, [decisions/resources](docs/decisions/resources.md)). It lies flat under its campaign: its `id`
is unique per campaign, and its chapter is a field that can change.

| Read/change | Create/list | App route |
| ----------- | ----------- | --------- |
| `GET/PATCH /api/campaigns/<campaign>/scenes/<id>` | `GET/POST /api/campaigns/<campaign>/scenes` | `/campaigns/<campaign>/scenes/<id>` |

`GET` responds with the scene itself — without `kind`, without `path`, all
fields side by side:

```json
{
  "id": "lighthouse-arrival",
  "title": "Ankunft am Leuchtturm",
  "type": "planned",
  "chapter": "01-salzhafen",
  "location": "leuchtturm",
  "npcs": ["jorna"],
  "handouts": ["Karte von Salzhafen"],
  "tags": ["social", "travel"],
  "status": "ready",
  "body": "\n## Flow\n\n…",
  "rev": 1
}
```

| Field | Meaning |
| ----- | ------- |
| `id` | stable, is referenced (`sceneId` of a log line, `[[id]]`) |
| `title` | display name, freely changeable; without a title of its own the scene shows its id |
| `type` | `planned` or `contingency` (contingency scene) |
| `trigger` | only for `contingency`: when does it fire? Free text; optional |
| `chapter` | chapter id; always set, must exist |
| `location` | location id, where the scene takes place; optional, must exist |
| `npcs` | list of NPC ids in their order; each must exist |
| `handouts` | names of the Roll20 handouts, reference only |
| `tags` | free; recommended: `combat`, `social`, `stealth`, `travel` |
| `status` | `draft`, `ready`, `played` or `dropped`; always set. Whether a scene has been played is said by `played` alone (see session) |
| `body` | Markdown of the scene |
| `rev` | row version, the guard of every write |

An optional field without a value is missing from the response; the three
lists are always present, empty if the scene names nothing. It is written
with `PATCH …/scenes/<id>` and `{ rev, force?, …subset of the fields }` —
`null` clears `trigger` or `location`, a field a scene does not have, or a
value of the wrong shape, is a 400 that names the field, a `status` outside
the four a 400 `status_not_allowed`, a `type` outside the two a 400
`scene_type_not_allowed`. The chapter can be changed but not cleared (400
`chapter_required`); when a scene changes its chapter, it lands at the end
of the target chapter. A stale `rev` is 409 with the current scene. Where it
stands in its chapter is not a field of the scene but the chapter's scene
order (see writing rules).

In the app a scene is edited in its **edit mode**, in place on its reading
route: title and trigger inline, the status beside the heading, the short
fields (type, location, NPCs, tags, handouts, chapter) as a row of chips,
and the text below. Saving sends one `PATCH` with only the fields that
changed; a 409 shows the conflict line above the title, with a reload and a
save anyway that again writes only the changed fields.

`POST …/scenes { title, chapter, id? }` creates a scene and responds with
it: the `id` is derived from the title if the request sets none, the
chapter must exist, and the scene stands as `draft` at the end of its
chapter. A taken `id` is a 409 `slug_taken` with a suggestion. Fixture and
generator proposal are the scene without `rev`. Augmenting hangs on the
scene: `POST …/scenes/<id>/augment` starts the run, `POST
…/scenes/<id>/augment/apply` accepts it.

### NPC

An NPC is its own resource with its own type (`Npc`, from the zod schema in
`shared/src/npc.ts`, [decisions/resources](docs/decisions/resources.md)):

| Read/change | Create/list | App route |
| ----------- | ----------- | --------- |
| `GET/PATCH /api/campaigns/<campaign>/npcs/<id>` | `GET/POST /api/campaigns/<campaign>/npcs` | `/campaigns/<campaign>/npcs/<id>` |

`GET` responds with the NPC itself — without `kind`, without `path`, all
fields side by side:

```json
{
  "id": "jorna",
  "name": "Hafenmeisterin Jorna",
  "role": "Auftraggeberin, Hafenmeisterin von Salzhafen",
  "chapter": "01-salzhafen",
  "status": "alive",
  "statblock": "Roll20: Jorna",
  "quickstats": { "insight": 2, "passive-perception": 12 },
  "voice": "knapp, wetterrau, duzt jeden",
  "appearance": "Ölmantel, graue Flechte, fehlender kleiner Finger links",
  "motivation": "Das Leuchtfeuer muss wieder brennen, …",
  "body": "\n## Weiß\n\n…",
  "rev": 4
}
```

| Field | Meaning |
| ----- | ------- |
| `id` | stable, is referenced |
| `name` | display name, required; without a name of its own the NPC shows its id |
| `role` | one-liner; optional |
| `chapter` | chapter id where introduced; optional, must exist |
| `status` | `alive`, `dead`, `missing` or `unknown`; always set |
| `statblock` | reference to the Roll20 sheet (`"Roll20: <sheet name>"`), not a copy; optional |
| `quickstats` | short values, free — only what is needed socially at the table (`{ "insight": "+2" }`); optional |
| `voice` | how he/she sounds; optional |
| `appearance` | one or two features; optional |
| `motivation` | what the character wants, one to three sentences — shown by the NPC card and the preview (under the "wants" label); optional |
| `body` | Markdown of the NPC |
| `rev` | row version, the guard of every write |

An optional field without a value is missing from the response. It is
written with `PATCH …/npcs/<id>` and `{ rev, force?, …subset of the fields }`
— `null` clears an optional field, a field an NPC does not have (such as
`atmosphere`), or a value of the wrong shape, is a 400 that names the field,
a `status` outside the four a 400 `status_not_allowed`; a stale `rev` is 409
with the current NPC.

`POST …/npcs { name, id?, body? }` creates an NPC and responds with it: the
`id` is derived from the name if the request sets none, `body` is its text,
and `status` is `unknown`. An NPC that already exists under the `id` and
holds nothing but its id is filled with name and text; one with content is a
409 `slug_taken` with a suggestion, and nothing is written. Fixture and
generator proposal are the NPC without `rev`. Augmenting hangs on the NPC:
`POST …/npcs/<id>/augment` starts the run, `POST …/npcs/<id>/augment/apply`
accepts it.

In the app an NPC is edited in the edit mode of its reading view: name,
status, `body` and every other field on one page, saved together as one
write. Quick stats, statblock and chapter are chips; role, voice, appearance
and `motivation` form its profile. An `[[id]]` in `motivation` appears as the
current name when shown, like in the text — a display, not a reference.

Text sections are free; recommended: `## Weiß` (`[!secret]` callouts),
`## Beziehungen` (one line per counterpart; a counterpart is linked with
`[[id]]` as everywhere in the text). No heading has a meaning for the app.

Minor NPCs get no NPC until they recur. Until then: a line in the scene text
or a `#npc` note in the log.

### Location

A location is its own resource with its own type (`Location`, from the zod
schema in `shared/src/location.ts`, [decisions/resources](docs/decisions/resources.md)):

| Read/change | Create/list | App route |
| ----------- | ----------- | --------- |
| `GET/PATCH /api/campaigns/<campaign>/locations/<id>` | `GET/POST /api/campaigns/<campaign>/locations` | `/campaigns/<campaign>/locations/<id>`, list `/campaigns/<campaign>/locations` |

`GET` responds with the location itself — without `kind`, without `path`,
all fields side by side:

```json
{
  "id": "leuchtturm",
  "name": "Der Leuchtturm von Salzhafen",
  "chapter": "01-salzhafen",
  "roll20Page": "Leuchtturm",
  "atmosphere": "Verlassen in Eile, nicht im Kampf.",
  "body": "\n## Beim ersten Betreten\n\n…",
  "rev": 3
}
```

| Field | Meaning |
| ----- | ------- |
| `id` | stable, is referenced |
| `name` | display name, required; without a name of its own the location shows its id |
| `chapter` | chapter id, optional; must exist |
| `roll20Page` | reference to the Roll20 page, not a copy of the map; optional |
| `atmosphere` | what the place reveals about itself, one to three sentences — shown by the location card and the preview; optional |
| `body` | Markdown of the location |
| `rev` | row version, the guard of every write |

An optional field without a value is missing from the response. It is
written with `PATCH …/locations/<id>` and `{ rev, force?, …subset of name,
chapter, roll20Page, atmosphere, body }` — `null` clears an optional field,
a field a location does not have (such as `status`), or a value of the wrong
shape, is a 400 that names the field; a stale `rev` is 409 with the current
location. `POST …/locations` creates a location and responds with it.
Fixture and generator proposal are the location without `rev`. Augmenting
hangs on the location: `POST …/locations/<id>/augment` starts the run, `POST
…/locations/<id>/augment/apply` accepts it.

In the app a location's fields are edited in its fields dialog;
`atmosphere`, like an NPC's `motivation`, is maintained on the text editing
surface, next to the Markdown, and an `[[id]]` in it appears as a name.
Without `atmosphere` the location card shows the Roll20 page.

Text sections are free; recommended: `## Beim ersten Betreten` (with
`[!readaloud]`), `## Wer ist hier` (characters at the place, with the id as
`[[id]]`).

### Thread

A thread is a plot thread a chapter carries, and its own resource with its
own type (`Thread`, from the zod schema in `shared/src/thread.ts`,
[decisions/resources](docs/decisions/resources.md)). It lies flat under the campaign, its chapter is a field: `GET
/api/campaigns/<campaign>/threads/<id>` responds with it.

```json
{
  "id": "wer-bezahlt-die-schmuggler",
  "chapter": "01-salzhafen",
  "text": "Wer bezahlt die Schmuggler?",
  "done": false,
  "rev": 1
}
```

| Field | Meaning |
| ----- | ------- |
| `id` | stable and opaque, assigned by the server on creation |
| `chapter` | chapter id, required; must exist (400 `chapter_unknown` otherwise) |
| `text` | the plot thread, one line |
| `done` | ticked off or open |
| `rev` | row version, the guard of every write |

- `GET …/threads` responds with all threads of the campaign, `GET
  …/threads?chapter=<chapter>` with those of one chapter — in the order in
  which they were created. Nothing is reordered.
- `POST …/threads { chapter, text }` creates an open thread at the end and
  responds with it (201); it carries **no** `rev`, because a new thread
  overwrites nothing. The text is one line: trimmed, line breaks become
  spaces, empty is 400.
- Ticking off, reopening, rewording and changing the chapter are `PATCH
  …/threads/<id> { rev, force?, …subset of chapter, text, done }`; it is
  deleted with `DELETE …/threads/<id> { rev }` (204). A stale `rev` is 409
  with the current thread under `thread`, an unknown id 404, a field a
  thread does not have a 400 that names it.
- No write to a thread touches the text or `rev` of its chapter, and a
  chapter write moves no thread. The threads are maintained in the chapter
  overview below the chapter's text: create, tick off, reword, delete. The
  debrief creates them (its accept-as-plot-thread action).

### Idea

An idea is a notion the DM drops in along the way, and its own resource with
its own type (`Idea`, from the zod schema in `shared/src/idea.ts`,
[decisions/resources](docs/decisions/resources.md)). `GET /api/campaigns/<campaign>/ideas/<id>` responds with it:

```json
{
  "id": "dorfschmied",
  "text": "Idee: Der Dorfschmied repariert auffällig oft Schmugglerwerkzeug #thread",
  "done": false,
  "rev": 1
}
```

| Field | Meaning |
| ----- | ------- |
| `id` | stable and opaque, assigned by the server on creation |
| `text` | the idea as it was typed, hashtags included; one line |
| `done` | ticked off or open |
| `rev` | row version, the guard of every write |

- `GET …/ideas` responds with all ideas in the order in which they were
  dropped in, ticked-off ones included; no ideas is an empty list (200).
- `POST …/ideas { text }` creates an open idea at the end and responds with
  it (201), without `rev`.
- Ticking off is `PATCH …/ideas/<id> { rev, force?, done }`. The text of an
  idea is written once: `done` is the only field a `PATCH` carries, every
  other — `text` included — is a 400 that names it. A stale `rev` is 409
  with the current idea under `idea`, an unknown id 404.

### Glossary term

A glossary term is a term of the source material and this campaign's way of
writing it, its own resource with its own type (`GlossaryTerm`, from the zod
schema in `shared/src/glossary-term.ts`, [decisions/resources](docs/decisions/resources.md)). `GET
/api/campaigns/<campaign>/glossary-terms/<id>` responds with it:

```json
{
  "id": "lighthouse-keeper",
  "term": "lighthouse keeper",
  "explanation": "Leuchtturmwärter",
  "rev": 1
}
```

| Field | Meaning |
| ----- | ------- |
| `id` | stable and opaque, assigned by the server on creation |
| `term` | the term as the source material writes it; once per campaign |
| `explanation` | how this campaign says it; may have several lines |
| `rev` | row version, the guard of every write |

- `GET …/glossary-terms` responds with all terms in the order in which they
  were created; nothing is reordered. The glossary page shows them
  alphabetically.
- `POST …/glossary-terms { term, explanation? }` creates a term at the end
  and responds with it (201), without `rev`. `term` is trimmed, empty is
  400. A term the glossary already has is answered by the server with 409
  `glossary_term_taken`, and nothing is written — also when rewording.
- It is changed with `PATCH …/glossary-terms/<id> { rev, force?, …subset of
  term, explanation }`, deleted with `DELETE …/glossary-terms/<id> { rev }`
  (204). A stale `rev` is 409 with the current term under `glossaryTerm`, an
  unknown id 404, a field a term does not have a 400 that names it.
- The search finds every term; the hit names itself with `kind:
  "glossary-term"` and its `id` and opens the glossary page. The text above
  the terms is not a term but the campaign's `glossaryIntro` field.

### Campaign knowledge

The campaign knowledge is the naming conventions, facts and style rules the
generator applies bindingly, even when the source material says otherwise.
Each piece of it is its own resource with its own type (`KnowledgeItem`,
from the zod schema in `shared/src/knowledge-item.ts`,
[decisions/resources](docs/decisions/resources.md)). `GET /api/campaigns/<campaign>/knowledge-items/<id>` responds with
it:

```json
{
  "id": "7c1f…",
  "kind": "naming",
  "from": "Salt Harbour",
  "to": "Salzhafen",
  "text": "",
  "rev": 1
}
```

| Field | Meaning |
| ----- | ------- |
| `id` | stable and opaque, assigned by the server on creation |
| `kind` | `naming` (naming convention), `fact` or `style` (style rule) |
| `from` / `to` | for `naming`: the source material's spelling and this campaign's; empty otherwise |
| `text` | for `fact` and `style`: the sentence; empty otherwise |
| `rev` | row version, the guard of every write |

- `GET …/knowledge-items` responds with all campaign knowledge in its
  order — the order in the prompt.
- `POST …/knowledge-items { kind, from?, to?, text? }` creates a piece at the
  end and responds with it (201), without `rev`; an omitted field is empty.
  A half naming convention is stored; the prompt skips it.
- It is changed with `PATCH …/knowledge-items/<id> { rev, force?, …subset of
  the fields }`, deleted with `DELETE …/knowledge-items/<id> { rev }` (204).
  Every text field is one line (400 otherwise). A stale `rev` is 409 with the
  current state under `knowledgeItem`, an unknown id 404.
- The **order** is set by the DM (up/down on the knowledge page). It is not
  a field of a piece but has its own write path: `GET`/`PUT
  /api/campaigns/<campaign>/knowledge-item-order` with `{ items, rev }`,
  where `items` names every id of the campaign knowledge exactly once (400
  otherwise). The `rev` is the guard of the order on the campaign; a stale
  state is 409 with the current order under `knowledgeItemOrder`. Neither
  the `rev` of a piece nor that of the campaign moves. Creating and deleting
  change the order along with them and move its guard.

### Session

A session is a game evening and its own resource with its own type
(`Session`, from the zod schema in `shared/src/session.ts`, [decisions/resources](docs/decisions/resources.md)).
`GET /api/campaigns/<campaign>/sessions/<id>` responds with it, its children
embedded — each with its own `id` and its own `rev`:

```json
{
  "id": "2026-01-15",
  "started": "2026-01-15T19:30:00",
  "startedMs": 1768501800000,
  "ended": "2026-01-15T22:45:00",
  "endedMs": 1768513500000,
  "body": "\n## Threads\n\n…",
  "pauses": [{ "id": "abendessen", "from": "2026-01-15T20:30:00", "fromMs": 1768505400000, "to": "2026-01-15T21:10:00", "toMs": 1768507800000, "rev": 1 }],
  "log": [{ "id": "spuren-gefunden", "at": "19:52", "sceneId": "lighthouse-arrival", "text": "Spuren gefunden, …", "reviewed": false, "rev": 1 }],
  "rev": 1
}
```

| Field | Meaning |
| ----- | ------- |
| `id` | stable and opaque, assigned by the server on start; order and date come from `started` |
| `started` / `startedMs` | start, to the second, zoneless local time of the server (`yyyy-mm-ddTHH:MM:SS`), next to it the server's epoch reading |
| `ended` / `endedMs` | end, likewise; both are missing while the session is running |
| `body` | free Markdown text of the session |
| `pauses` | its pauses (see pause) |
| `log` | its log lines (see log line) |
| `rev` | row version of the session; every child carries its own |

- **Time:** only the server knows which clock the zoneless timestamps belong
  to, so it delivers the epoch reading next to them (`…Ms`), and the client
  only computes with numbers: running time = (`endedMs` ?? now) −
  `startedMs` − sum of the closed pauses. The client writes a point in time
  as an epoch value as well; the server stores its reading in its time
  zone.
- `GET …/sessions` responds with all sessions, **newest first** (by
  `started`, on a tie by order of creation), each with its children. The
  first is the most recently started, ended or not — the debrief's session,
  even when the evening went past midnight.
- `GET …/sessions?running=true` responds with the **running** session or
  none: the most recently started one that is not ended — started today or
  earlier, so a session past midnight keeps running. Which session is
  running is always said by the server, never by the browser's date.
- `POST …/sessions {}` starts a session now and responds with it (201). If
  one started today is already running, it comes back unchanged (200); if
  one from an earlier day is running, that is 409 `session_running` with its
  `id`, and nothing starts. Ending is final: a start afterwards is a new
  session, even on the same day.
- `PATCH …/sessions/<id> { rev, force?, startedMs?, endedMs? }` ends the
  session (`endedMs`), lets it keep running (`endedMs: null`) or corrects
  its start. Ending closes an open pause in the same operation, and its
  `rev` moves along. A session `PATCH` does not write the children; a field
  it does not take is a 400 that names it, a stale `rev` 409 with the
  current session under `session`.
- `DELETE …/sessions/<id> { rev }` discards an **empty** session (204) — the
  undo of an accidental start. If it has a log line or text, that is 409
  `session_not_empty`: it is ended, not deleted.
- An ended session accepts no new pause or log line (409 `session_ended`);
  correcting its pauses and reviewing its log lines still works.
- A scene is **played** solely through its `status` (`played`); a session
  holds no list of played scenes of its own, and
  `POST …/sessions/<session>/played-scenes` responds 404. In the live view a
  played checkbox sits to the left of the next-scene action: checked, the
  next-scene action sets the scene being **left** to played with `PATCH
  …/scenes/<id> { rev, status: "played" }` before the next one opens;
  unchecked, it only opens the next one. The checkbox is checked when the
  session has a log line with the `sceneId` of the open scene, and the DM
  can change it; the write happens only on the click. If the scene was
  changed elsewhere in the meantime (409), the next one does not open, the
  scene is reloaded, and the next click writes against its fresh `rev`. A
  note alone and ending the session change no status.
- The reading page of a session shows the scenes in which its log lines
  were noted — each once, in the order of its first note.

### Pause

A pause is an interval in which the session's clock stands still, and its
own resource (`Pause`, from `shared/src/pause.ts`) under its session:
`{ id, from, fromMs?, to?, toMs?, rev }`. A pause without `to` is the
running one.

- `POST …/sessions/<session>/pauses {}` begins a pause now (201). A session
  has at most one open pause: if one is already open, it comes back
  unchanged (200).
- `PATCH …/sessions/<session>/pauses/<id> { rev, force?, fromMs?, toMs? }`
  ends it (`toMs`) or corrects an end, as an epoch value. A stale `rev` is
  409 with the current pause under `pause`.
- A pause writes **no** log line, and no write to a pause moves the
  session's `rev`.

### Log line

A log line is a quick note of the DM and its own resource (`LogEntry`, from
`shared/src/log-entry.ts`) under its session:
`{ id, at, sceneId?, text, reviewed, rev }`.

- A log line is **columns**, not a Markdown line: `at` (`HH:mm`, the
  server's clock) and `sceneId` are set on creation, the hashtags are in the
  `text`. `id` is stable and opaque.
- `POST …/sessions/<session>/log { text, sceneId? }` creates a line at the
  end (201). The text is one line (trimmed, line breaks become spaces, empty
  is 400); `sceneId` must name a scene (400 `log_scene_unknown` otherwise).
- The log is append-only: `PATCH …/sessions/<session>/log/<id> { rev,
  force?, reviewed }` is the only change — the debrief reviews the line.
  Every other field, `text` included, is a 400; a stale `rev` is 409 with
  the current line under `logEntry`.

## References point to existing rows

A reference names a row that exists. Whoever enters an id in a scene's
`npcs:`, in `location:`, in `chapter:` or in a log line for which there is no
NPC, no location, no chapter or no scene gets a 400 with the hint to create
it first — nothing comes into being on the side. Chapters, scenes, NPCs and
locations come into being through the create actions and through accepting
a generator proposal, nowhere else.

`location:` requires an id in slug form (400 otherwise). Every scene belongs
to a chapter; `chapter:` cannot be cleared.

A mention in the **text** is not a reference in this sense: `[[id]]` and
whatever stands under `## Beziehungen` remain visible text. An `[[id]]` for
which there is no NPC, no location and no scene is shown as text — no error,
and nothing is created. An empty NPC or location is normal, by the way:
created and not yet filled, it appears as a thin card and can be filled at
any time.

## Text

The text (`body`) of a campaign, a chapter, a scene, an NPC or a location is
Markdown. What the renderer understands — and what the generator must
produce:

### Sections (H2)

| Heading | Meaning |
| ------- | ------- |
| `## Flow` | standard course when nothing special happens |
| `## If: <condition>` | branch; the condition is free text (German), rendered collapsible |
| everything else | normal section, no special treatment |

### Callouts (Obsidian syntax)

| Callout | Meaning / rendering |
| ------- | ------------------- |
| `> [!readaloud]` | read-aloud text — large, serif, copy button for the Roll20 chat |
| `> [!check]` | dice mechanics (DCs, contested checks) — visually prominent |
| `> [!secret]` | information the players do NOT have |
| `> [!outcome]` | consequence beyond the scene — a candidate for a plot thread |
| `> [!loot]` | loot / items |
| `> [!note]` | free-text marginal note of the DM |

### Tables (GFM pipe tables)

The only construct taken over from GFM — for random tables and encounter
lists that would be unreadable as prose. Syntax: a **header row**, a
**separator row** of `|---|` (one cell per column) and **edge pipes** left and
right in every row. Tables apply in every text, in **every callout** and in
`## If:` sections.

```markdown
> [!note] Zufallsbegegnung an der Bucht
>
> | W6 | Was die Brandung anschwemmt |
> | --- | --- |
> | 1–2 | Ein leeres Fass mit fremdem Brandzeichen |
> | 3–4 | Ein Ruder, frisch gekerbt |
> | 5–6 | Eine Laterne, das Glas rußgeschwärzt |
```

(In a callout the table stands in the same `>` block as the text — see the
scene `lighthouse-arrival`,
`fixtures/beispiel/scenes/lighthouse-arrival.json`.)

- **Tables only.** No strikethrough (`~~x~~`), **no task lists**, no
  autolinks, no footnotes. `- [x]` deliberately stays normal list text: it is
  the tick-off syntax of the ideas, not a checkbox.
- **Degradation as everywhere**: a line with pipes without a valid separator
  row is not a table but text.
- **Display**: the table scrolls in a container of its own; on a phone the
  table scrolls, never the page.
- **Block composer**: a table is not a block type of its own but part of the
  text or callout block; it is edited as Markdown.

### References in running text: `[[id]]`

`[[jorna]]` in the text is a reference to an NPC, a location or a scene. It
applies in every text (scene, NPC, location, chapter, campaign) and in every
callout.

- **The id is always what is stored**, never the name. Only the display puts
  in the current display name — if a name or title changes, the text is
  right everywhere without any other row being touched.
- Referenceable are **NPC, location and scene**. If ids collide across
  kinds, **NPC > location > scene** wins. Chapters are not referenceable.
- The brackets hold **only the id** in kebab case (`[[alte-mole]]`); there is
  **no display text** (`[[jorna|Jorna]]` is normal text). Endings stand
  outside: `[[jorna]]s Boot` → "Jornas Boot".
- **Code is not prose**: in code blocks and in `` `[[jorna]]` `` the spelling
  stays literal — not resolved and not indexed.
- In the header line of an `## If:` branch the resolved **name appears as
  text** (not a link): the click folds the branch.
- **Degradation**: an id for which nothing exists stays visible as `[[id]]` —
  no error, and it comes alive as soon as it exists.
- Click: in the reading view a link to the target; in the session view it
  opens the detail drawer without leaving the session.
- Hovering or keyboard focus shows a short **preview** of the target (kind,
  status and the lines of the compact card); an `[[id]]` in its excerpt
  appears there — as on the NPC and location cards — as a name. On touch
  devices there is no preview.
- Names as normal text are still allowed — but they stay as they are when
  the name or title changes.

### Hashtags in the log

`#thread` open thread · `#npc` improvised NPC · `#loot` loot ·
`#decision` player decision · `#date` in-game date (e.g. `#date Tag 4`)

`#pc` note about a player character. An optional second tag names the
character (`#pc #kaela`); the names are free, there is no PC entity and
nothing to maintain. The debrief collects such lines in its player
characters section, grouped by the second tag (without a second tag: under
a general heading). `#pc` wins over the other tags: the line is not offered
as a plot thread or NPC, but only ticked off (done) or left open (keep) —
PC notes are reminders for the table, not campaign content.

## Ideas

Ideas are dropped in and afterwards only ticked off, independent of sessions
and with the same hashtags as the log. Each is its own resource (see idea);
the debrief shows the open ones together with the log.

## Debrief

- The accept-as-plot-thread action creates a thread of the active chapter
  (`POST …/threads { chapter, text }`); the chapter's text and `rev` stay
  untouched. The threads are maintained in the chapter overview: tick off,
  reword, delete, add by hand.
- The create-NPC action creates the NPC via `POST …/npcs { name, id, body }`,
  with `status: unknown` (the log line says nothing about its state); its
  text is exactly the log text, without a heading. An NPC that holds nothing
  but its id under that id is filled. If it already holds something, that is
  a 409 with a suggestion: nothing is written, the debrief shows the
  conflict, and the log line stays open.
- Ticking off an idea sets `done` on the idea (`PATCH …/ideas/<id> { rev,
  done }`), so that it does not reappear in every future debrief.

## Writing rules

- Writes go exclusively through the API (every endpoint is documented at its
  route, in the module of its resource `server/src/routes/<resource>.ts`):
  log, debrief, generator proposals — and for every entity its own `PATCH`
  on its resource, which writes any subset of its fields, `body` included,
  in one go ([decisions/writes](docs/decisions/writes.md), [decisions/resources](docs/decisions/resources.md)); thread, idea, glossary term,
  campaign knowledge, pause and log line included, which have no `body`. No
  list is swapped as a whole.
- Conflict protection: every write carries the row version `rev` that the
  read delivered. If it no longer matches, the server responds 409 and the
  app shows its changed-in-the-meantime conflict line with a reload instead
  of silently overwriting.
- The **scene order** of a chapter has its own write path and its own guard:
  `PUT /api/campaigns/<campaign>/chapters/<chapter>/scene-order` with
  `{ scenes, rev }`, where `scenes` is the complete list of the scene ids of
  that chapter (400 otherwise). The `rev` is `scene_order_rev`, which the
  chapter node delivers — not the `rev` of a scene and not that of the
  chapter; if it does not match, that is 409. Only the order is written:
  neither `scenes.rev` nor `chapters.rev` moves, so that an open scene or
  chapter editor does not run into a conflict because of a reordering
  ([decisions/scene-order](docs/decisions/scene-order.md)). The order of the campaign knowledge is built the same way
  (`PUT …/knowledge-item-order { items, rev }`, see campaign knowledge).
- The log is append-only ([decisions/writes](docs/decisions/writes.md)): a log line is written once and
  afterwards only reviewed. An idea is written once and afterwards only
  ticked off.

## Generator

See `generator/README.md`. Short version: source text (EN) in → proposed
scenes (DE, this format) out, always `status: draft`, always with a review of
the proposals before accepting.

A scene run is a **pipeline**: an outline call fixes the scenes and their
ids, after which every scene and every new NPC and location is written
separately. A shape error costs only the affected part, finished scenes can
be reviewed right away, and a broken part can be retried on its own. The
outline is an internal step — it is never shown. If the run creates its
chapter, the outline describes it from the source material; the review of
the proposals shows this description, and accepting creates the chapter
with it as its text. No run changes the text of an existing chapter.

**Every** call responds with a JSON object whose schema the server
**enforces** via the provider API. A scene, NPC or location call (creating
as well as augmenting) returns the scene, the NPC or the location without
`rev`, all fields side by side, plus the hints for the DM under `warnings`;
a new scene is always `draft`, and an NPC's `quickstats` travel as a list of
pairs `{ key, value }`. Scene, NPC and location derive their schema
themselves from their zod schema (`z.toJSONSchema`, [decisions/resources](docs/decisions/resources.md)), and what the
model needs to know about their fields is in their prompt
(`generator/system-prompt.md`, `generator/npc-system-prompt.md`,
`generator/location-system-prompt.md`). A job lists the proposed scenes
under `result.scenes`, the NPCs under `result.npcs` and the locations under
`result.locations`; an NPC run carries its one NPC under `npcResult.npc`.
The DM's changes to a proposal are kept per scene under `sceneEdits` and per
NPC under `npcEdits`. The job is its own resource (`…/generator-jobs/<id>`,
at most one per campaign): it is reviewed and accepted with `PATCH` on it,
discarded with `DELETE`. Details in `generator/README.md`.

The mechanical check reads the fields and the text, but no heading
([decisions/data-shape](docs/decisions/data-shape.md)): the sections of a proposal are the prompts' recommendation.
Every `[[id]]` in a generated text names an NPC, a location or a scene of
the campaign or a proposal of the same run; otherwise the response goes back
as a correction turn. In an augment run this applies to the references the
proposal newly brings; what already stands in the existing text is left to
the DM. An `[[id]]` in code does not count as a reference, as everywhere.

## Fixtures

The example campaign lies as JSON under `fixtures/beispiel/`, one object per
file, exactly in the shape the API speaks. Every entity with its own
resource lies in its own directory, every file exactly the object its
resource returns, without `rev` ([decisions/resources](docs/decisions/resources.md)): the campaign under
`fixtures/beispiel/campaigns/<id>.json`, a chapter under
`fixtures/beispiel/chapters/<id>.json`, a scene under
`fixtures/beispiel/scenes/<id>.json`, an NPC under
`fixtures/beispiel/npcs/<id>.json`, a location under
`fixtures/beispiel/locations/<id>.json`, a thread under
`fixtures/beispiel/threads/<id>.json`, an idea under
`fixtures/beispiel/ideas/<id>.json`, a glossary term under
`fixtures/beispiel/glossary-terms/<id>.json`, a piece of campaign knowledge
under `fixtures/beispiel/knowledge-items/<id>.json` and a session under
`fixtures/beispiel/sessions/<id>.json`, its pauses and log lines embedded,
without `rev` and without the epoch readings — those are the server's
reading in its time zone. It is the reference for callouts and the only
source for tests and E2E; the bodies are therefore never reformatted.

`grimoire seed <dir>` is the dev/E2E tool for it: it reads
`<dir>/<campaign>/*.json` together with the directories `campaigns/`,
`chapters/`, `scenes/`, `npcs/`, `locations/`, `threads/`, `ideas/`,
`glossary-terms/`, `knowledge-items/` and `sessions/` below it and writes
the rows into a database through the store layer. The server itself seeds
nothing — a fresh instance starts empty.
