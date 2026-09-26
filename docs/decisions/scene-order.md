# Chapter, location and order of scenes

## Decision

- **At most one chapter per campaign is active,** and the rule belongs to the
  status field, not to an endpoint: every write path that activates a chapter
  sets the previously active one back to planned in the same transaction.
- **One value, one source.** The location of a scene is one field; nothing is
  derived from it, neither a grouping nor the scene's URL.
- **The DM sets the order of scenes.** A chapter shows its scenes as one list
  in the DM's order, not grouped by location. The order is not a field of the
  scene: it is what the list states about the scene, not what the scene
  states about itself.
- **An order is written as a whole,** as the complete list, under a guard of
  its own that counts only reorderings. Reordering moves neither the scenes'
  nor the chapter's `rev`.
- **New scenes land at the end** of their chapter, also when a scene moves to
  another chapter.
- **A generator run keeps its own order.** Its scenes stand at a start value
  fixed on the run's first apply plus their number in the run's outline, so
  the outline order holds however many partial applies happen in whatever
  order. If the DM reorders the chapter in between, the DM's order wins and
  further applies append at the end.
- **Reordering is up/down,** not drag and drop.

## Why

Two sources for one truth always drift: a group beside the location field
would contradict it after the first correction, and a derived column would
oblige every write path to maintain it.

An order by id or name would fall out incidentally instead of being set.
Preparation means deciding in which order to tell things, and two scenes at
the same location can lie far apart dramaturgically.

An order is a statement about a set; accepting a partial list would mean
sorting the rest somewhere. A guard of its own keeps a reordering from
colliding with an open text edit: a guard that fires on unrelated writes
trains the user to click conflicts away and then misses the real overwrite.

A recomputed "end of chapter" per apply would scatter a run's scenes; a new
start value after a manual sort would sort around the DM's order.

Up/down works the same with keyboard and pointer, works on a phone, needs no
library and keeps the list calm ([docs/UI-BRIEF.md](../UI-BRIEF.md)); drag
and drop could later be another gesture on the same endpoint.

If the one-active-chapter rule hung on an endpoint, any other write path
would be a door around it.

## Consequences

- There is no order across chapter boundaries, and sorting by status or
  location is not a view: the chapter overview filters, it does not reorder.
- Other orders the DM sets follow the same pattern (`decisions/resources`).
