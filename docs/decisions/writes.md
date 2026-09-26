# Writing: in the app, with a guard, one path per entity

## Decision

### App-first

Editing happens in the app. The target is every maintenance operation from
within the app, and prioritization follows from that. The database is the
truth (`decisions/sqlite`); there is no data path that bypasses the app, such
as an external editor. The app's writes go only through the documented API.

Log lines and ideas are append-only: they are written once. The only changes
afterwards are reviewing a log line (`reviewed`) and checking off an idea
(`done`); any other field in the patch is 400.

### One guard per row

Every entity carries its own `rev`, the row version. A write applies only if
`rev` is unchanged, moves only the `rev` of the row it writes, and is 409
otherwise. There is no counter across all rows of a kind. An order has its
own guard (`decisions/resources`, `decisions/scene-order`).

### One write path per entity

Every entity has exactly one write path, `PATCH` on its own resource with
`{ rev, force?, …subset of its fields }`, validated against the entity's
schema.

- At least one field must be present, otherwise 400 `nothing_to_write`. All
  fields together are **one** write in one transaction, against **one**
  `rev`: one row change, one step of `rev`, one version counter, one index
  run. How much a request carries cannot be read from `rev`.
- `null` clears an optional field. A field the entity does not have, or a
  value of the wrong shape, is a 400 that names the field. The `id` never
  changes (`decisions/constraints`).
- A stale `rev` is 409 `rev_conflict` and carries, besides the current `rev`,
  the **current state** of the resource under the entity's name
  (`{ thread }`, `{ idea }`, `{ glossaryTerm }` …): the conflict dialog shows
  what is in the way without reloading. The same 409 shape applies to every
  guarded write.
- `force: true` writes onto the row as it is now, and writes only the fields
  sent: a status changed elsewhere survives a forced text save.
- Creating answers with the entity's type, including `POST /api/campaigns`
  (`Campaign`), and carries no `rev`, because a new row overwrites nothing.
  `DELETE` carries `{ rev }` like every guarded write.
- The app holds the `rev` of the ongoing edit and sends it along, instead of
  freezing it and guessing.

### Conflict line in the app

On 409 a dialog or editor shows the conflict line with two actions:
„Neu laden" (reload) discards the draft and takes the saved state,
„Trotzdem speichern" (save anyway) writes with `force` only the fields that
have changed — a property changed elsewhere stays.

## Why

All fields of an entity, `body` included, live in one row and share one
guard. Two write paths onto the same row would make the first response
invalid through the second call itself, and the app would have to guess the
next `rev` instead of knowing it.

Silent overwriting is the one error that a single user with two tabs still
has. The guard catches it; `force` with only the changed fields keeps the
deliberate overwrite case as narrow as possible.

## Consequences

- Because all fields of a scene share one row and one guard, even a pure
  status write by a second writer is a conflict for an open text editor.
- Applying a generator proposal is no way around these rules: it checks the
  same fields and references as creating its entity (`decisions/generator`).
- Every write additionally increments `campaigns.version`
  (`decisions/polling`); that is not a guard.
