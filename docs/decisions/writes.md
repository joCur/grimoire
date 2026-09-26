# Writing: in the app, with a guard, one path per entity

## Decision

- **App-first.** Content is maintained in the app, and every write goes
  through the documented API. There is no data path around it, such as an
  external editor.
- **One guard per row.** Every entity row carries its own `rev`. A write
  applies only if `rev` is unchanged and moves only the `rev` of the row it
  writes; otherwise it is 409. An order has a guard of its own
  (`decisions/resources`).
- **One write path per entity:** `PATCH` on its resource with `rev`, an
  optional `force` and any subset of its fields, validated against its
  schema. All fields of one request are one write in one transaction against
  one `rev`. `null` clears an optional field; an unknown field or a wrong
  shape is a 400 that names the field.
- **A conflict carries the current state.** A stale `rev` is 409 with the
  current row, so the app can show what is in the way without reloading.
- **Overwriting is deliberate and narrow.** On a conflict the app offers two
  actions: reload (discard the draft, take the saved state) or save anyway,
  which writes with `force` only the fields that changed, so a field changed
  elsewhere survives.
- Creating carries no `rev`, because a new row overwrites nothing; deleting
  carries one like every guarded write.
- Records of what happened during play are written once; afterwards only
  their review state changes.

## Why

All fields of an entity, `body` included, live in one row. Two write paths
onto one row would invalidate each other's responses, and the app would have
to guess the next `rev` instead of knowing it.

Silent overwriting is the one error a single user with two tabs still has.
The guard catches it; `force` limited to the changed fields keeps the
deliberate overwrite as narrow as possible.

## Consequences

- Because all fields share one guard, even a pure status write by a second
  writer is a conflict for an open text editor.
- Applying a generator proposal follows the same rules as creating its
  entity (`decisions/generator`).
- The campaign's version counter (`decisions/polling`) is a refresh signal,
  not a guard.
