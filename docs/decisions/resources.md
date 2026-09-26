# One resource and one type per entity

## Decision

Every entity of the database is a resource of its own with its own type, its
own zod module as the single source, and its own app route. There is no
general endpoint across several entities, neither in the API nor in the app.

### URL scheme

Every campaign-dependent path hangs under the campaign — in the API
`/api/campaigns/:id/…`, in the app `/campaigns/:id/…`. The plural
`campaigns` also applies to the single campaign (`GET /api/campaigns/:id`).
Campaign-independent are `/api/campaigns`, `/api/settings` and `/settings`.
URL segments are the English plural of the entity. A URL that names nothing
answers 404, without redirect and without alias.

| Entity | Read/change | Create/list | App route |
|---|---|---|---|
| Campaign | `GET/PATCH /campaigns/:c` | `POST /campaigns` | `/campaigns/:c` |
| Chapter | `GET/PATCH /campaigns/:c/chapters/:id` | `GET/POST /campaigns/:c/chapters` | `/campaigns/:c/chapters/:id` |
| Scene | `GET/PATCH /campaigns/:c/scenes/:id` | `GET/POST /campaigns/:c/scenes` | `/campaigns/:c/scenes/:id` |
| NPC | `GET/PATCH /campaigns/:c/npcs/:id` | `GET/POST /campaigns/:c/npcs` | `/campaigns/:c/npcs/:id` |
| Location | `GET/PATCH /campaigns/:c/locations/:id` | `GET/POST /campaigns/:c/locations` | `/campaigns/:c/locations/:id` |
| Thread | `GET/PATCH/DELETE /campaigns/:c/threads/:id` | `GET/POST /campaigns/:c/threads` | in the chapter overview |
| Idea | `GET/PATCH /campaigns/:c/ideas/:id` | `GET/POST /campaigns/:c/ideas` | in the post-session review and the mobile start screen |
| Glossary term | `GET/PATCH/DELETE /campaigns/:c/glossary-terms/:id` | `GET/POST /campaigns/:c/glossary-terms` | on the glossary page `/campaigns/:c/glossary` |
| Campaign knowledge | `GET/PATCH/DELETE /campaigns/:c/knowledge-items/:id` | `GET/POST /campaigns/:c/knowledge-items` | on the knowledge page `/campaigns/:c/knowledge` |
| Session | `GET/PATCH/DELETE /campaigns/:c/sessions/:id` | `GET/POST /campaigns/:c/sessions` | `/campaigns/:c/sessions/:id`, live `/campaigns/:c/live` |
| Pause | `PATCH /campaigns/:c/sessions/:s/pauses/:id` | `POST /campaigns/:c/sessions/:s/pauses` | in the session |
| Log line | `PATCH /campaigns/:c/sessions/:s/log/:id` | `POST /campaigns/:c/sessions/:s/log` | in the session and the post-session review |
| Played scene | — | `POST /campaigns/:c/sessions/:s/played-scenes` | in the session |
| Generator job | `GET/PATCH/DELETE /campaigns/:c/generator-jobs/:id` | `GET/POST /campaigns/:c/generator-jobs` | on the generator page `/campaigns/:c/generate` and in the augment dialogs |
| Part of a run | `PATCH /campaigns/:c/generator-jobs/:j/parts/:key` | — | in the generator job |

The API paths live under `/api`.

### Wire

- Every resource answers with its own type, for example
  `Location { id, name, chapter?, roll20Page?, atmosphere?, body, rev }`: all
  fields side by side, `body` included where the entity has one. There is no
  `kind`, no `path`, no common base type and no union of several entities;
  which one is meant is stated by the URL. Field names are ordinary
  identifiers (`roll20Page`).
- **No umbrella terms.** Every field is a field of its entity, `body`
  included. Types, code and docs describe each entity with its own fields;
  there are no halves of an entity and no common shape that stands for
  several entities.
- **Where things are mixed, the hit names its entity.** A search hit is
  `{ kind, id, title }`: search really is mixed, so the hit carries `kind`,
  and the app opens the entity's route from it. `[[id]]` references resolve
  against the resources.
- **The client writes points in time as epoch values.** A point in time is
  stored as the server's zoneless local time (`decisions/constraints`); only
  the server knows which clock it belongs to. It therefore delivers the epoch
  reading alongside (`startedMs`, `toMs` …), and a write names a point in time
  in exactly this form.

### Keys and nesting

- **Stable keys.** Every entity has a stable `id`, and URL, wire and
  references name it by that — never by its position and never by a
  changeable text. If the DM does not set the id themselves (thread, idea,
  glossary term, campaign knowledge), the server assigns an opaque one on
  creation. A text that may appear only once per campaign (the term of a
  glossary term) is a field with a unique index, not a key.
- **Flat or nested.** An entity that can move between parents lies flat
  under the campaign, and its parent is a field: a scene under
  `…/scenes/:id`, a thread under `…/threads/:id`, each with `chapter`. Their
  ids are unique per campaign, their URL does not change when they move, and
  the list filters by parent (`…/threads?chapter=<id>`). An entity that does
  not exist without its parent and never moves hangs under it: pause, log line
  and played scene under their session. Such a child is read embedded in its
  parent; it is written only through its own resource, and a write to the
  parent does not write it.

### Transitions are changes to resources

A state is a field: a change is a `PATCH` on it, a beginning a `POST`, a
discard a `DELETE`. There are no action endpoints.

- Checking off an idea is `PATCH …/ideas/:id { rev, done }`.
- Which chapter is active is stated by its `status` (`decisions/scene-order`).
- A session starts with `POST …/sessions`, ends with
  `PATCH …/sessions/:id { rev, endedMs }` and is discarded with `DELETE`.
  A pause begins with `POST …/pauses` and ends with
  `PATCH …/pauses/:id { rev, toMs }`. Which session is running is stated by a
  filter on the list (`…/sessions?running=true`, one or none), not a separate
  endpoint; the list is newest first.
- A generator run begins with `POST …/generator-jobs { kind, … }` or on the
  resource it augments; it is reviewed, applied, retried and discarded on its
  own resource (`decisions/generator`).

### Order

Where the DM sets an order, a dedicated endpoint with its own guard on the
owner of the order writes it, and no entity's `rev` moves: the scenes of a
chapter (`…/chapters/:id/scene-order`, `decisions/scene-order`) and the
campaign knowledge of a campaign (`PUT …/knowledge-item-order { items, rev }`,
guard `campaigns.knowledge_item_order_rev`). A stale state is 409 with the
current order. Where the order names all rows of a campaign, creating and
deleting also move its guard, because both change what it enumerates. Where
the app does not sort, the order of creation applies, and there is no order
endpoint (thread, idea, glossary term).

### One source per entity: its zod schema

The schema of every entity is a zod schema in `shared/src/<entity>.ts`. From
it come the TypeScript type (`z.infer`), the validation of `PATCH`, `POST` and
seed, and the generator's response schema (`decisions/generator`). None of
these shapes is rebuilt by hand: each entity derives its shapes itself and
explicitly with zod's API (`omit`, `extend`, `partial`, `nullable`,
`z.toJSONSchema`). There is no common module that iterates over the fields of
arbitrary entities. `server/src/db/schema.ts` describes the storage shape;
both are kept in sync.

### Server and app

- **Server:** The domain module of an entity (`server/src/store/<entity>.ts`)
  renders, reads, writes and applies it, typed. Routes never access SQL
  directly. One route module per resource (`server/src/routes/<resource>.ts`)
  documents its endpoints with one comment per route.
- **App: every entity manages itself.** Everything the app knows about an
  entity lives in its folder `app/src/<entity>/`: route and reading view,
  actions, edit hook and create dialog, card, preview, summary and drawer
  content, its form fields, link and label, the parts of the generator that
  concern only it, and the tests next to them. The form fields are typed
  against the entity's type, so a field without a form field does not
  compile.
  - Slices do not import each other. Shared are only UI building blocks with
    no knowledge of entities (form fields in `app/src/components/fields/`,
    card shell, short form, dialog and editor surfaces); none knows a
    `kind`.
  - Where things really are mixed — `[[id]]` resolution, search, campaign
    tree, top bar, page context, live drawer — there is only a dispatcher: it
    maps an id or a hit to its entity; label, link and preview come from that
    entity's slice.
  - No barrel: callers import the concrete file (`@/npc/NpcCard`).

## Why

The database holds each entity in its own table with its own columns. A
common endpoint with an untyped mapping of the fields loses this typing on
the way to the wire: the permitted keys then need a list of their own, their
shapes a description of their own, the generator schemas a third version, and
store and app branch at every place on which entity is meant.

zod delivers type, validation and JSON schema from one description, in the
language of the rest of the code; the shapes cannot drift apart because there
is only one (`decisions/dependencies`).

If the campaign id were the first segment, it would collide with every
campaign-independent path — `/:campaign` would also match `/settings` — and
force special cases at several places in the app, which would grow with every
new campaign-independent path. With the prefix the collision is ruled out
rather than caught, and extensions have a pattern.

## Consequences

- A new field is one line in its entity's schema and one in its form fields,
  plus its column with a migration. Type, validation and generator schema
  follow.
- Write paths follow `decisions/writes`, fixtures `decisions/data-shape`.
