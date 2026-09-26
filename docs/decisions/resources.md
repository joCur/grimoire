# One resource and one type per entity

## Decision

Every entity of the database is a resource of its own, with its own type, its
own zod schema as the single source, and its own app route. There is no
general endpoint across several entities, neither in the API nor in the app.

### URLs

- Everything that belongs to a campaign hangs under the campaign, in the API
  (`/api/campaigns/:id/…`) and in the app (`/campaigns/:id/…`). URL segments
  are the English plural of the entity.
- A URL that names nothing answers 404, without redirect or alias.

### Wire

- A resource answers with its own type: all fields side by side and its
  `rev`. There is no common base
  type, no `kind` and no union of entities; the URL says which one is meant.
- **No umbrella terms.** Every field is a field of its entity; there are no
  halves of an entity and no shared shape standing for several entities.
- **Where things are mixed, the result names its entity** (`kind` and `id`),
  and the app opens that entity's route.
- **Points in time:** the server stores zoneless local time, because only it
  knows which clock applies; the client reads and writes epoch values, and
  the server converts.

### Keys and nesting

- **Stable keys.** Every entity has a stable `id`; URL, wire and references
  name it by that, never by position or by changeable text. Where the DM does
  not choose the id, the server assigns an opaque one. A text that must be
  unique per campaign is a field with a unique index, not a key.
- **Flat or nested.** An entity that can move between parents lies flat under
  the campaign, and its parent is a field; its URL does not change when it
  moves, and lists filter by parent. An entity that cannot exist without its
  parent and never moves hangs under it, is read embedded in the parent, and
  is written only through its own resource.

### State changes are resource changes

A state is a field: a change is a `PATCH`, a beginning a `POST`, a discard a
`DELETE`. There are no action endpoints. A question such as "which one is
running" is a filter on the list, not a separate endpoint.

### Orders

Where the DM sets an order, it is written as a whole through a dedicated
endpoint with its own guard on the owner of the order; no entity's `rev`
moves (`decisions/scene-order`). A stale order is 409 with the current one.
Where the app does not sort, the order of creation applies.

### One source per entity: its zod schema

The schema of each entity is a zod schema in `shared/`. Its type, the
validation of create, patch and seed, and the generator's response schema
are derived from it, each explicitly with zod's own API; none is rebuilt by
hand, and no generic module iterates over the fields of arbitrary entities.
The storage schema is kept in sync with it.

### Server and app

- **Server:** one store module per domain carries all reads and writes of its
  entity; routes never run SQL. One route module per resource documents its
  endpoints where they are defined.
- **App:** everything the app knows about an entity lives in that entity's
  slice. Slices do not import each other. Shared code is limited to UI
  building blocks without knowledge of entities. Where things really are
  mixed (search, reference resolution, navigation), there is only a
  dispatcher that hands over to the entity's slice. Pages that show several
  entities compose slices and pass foreign parts in as slots. There are no
  barrels.

## Why

The database holds each entity in its own table with its own columns. A
common endpoint with an untyped mapping loses that typing on the way to the
wire: permitted keys, shapes and generator schemas then each need a
description of their own, and store and app branch everywhere on which
entity is meant.

zod delivers type, validation and JSON schema from one description in the
language of the rest of the code; the shapes cannot drift apart because
there is only one.

With campaign paths under `/campaigns/:id` instead of the campaign id as the
first path segment, campaign-independent paths cannot collide with a
campaign id, and new paths have a pattern instead of special cases.

## Consequences

- A new field is a change to its entity's schema, its form field and its
  column; type, validation and generator schema follow.
- Write paths follow `decisions/writes`, fixtures `decisions/data-shape`.
