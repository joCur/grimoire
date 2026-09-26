# Chapter, location and order of scenes

## Decision

### The chapter status is an enum, at most one chapter is active

A chapter's status is `planned | active | done`, defined exactly once in
`shared/src/chapter.ts` (`CHAPTER_STATUSES`), with the labels de
„Geplant / Aktiv / Abgeschlossen", en "Planned / Active / Done". The column is
a CHECK constraint; any other value is 400 (`decisions/constraints`). A newly
created chapter starts at `planned`.

`active` is a decision about two chapters, and "at most one active chapter
per campaign" belongs to the **field, not to an endpoint**: every write path
that sets `active` — `PATCH …/chapters/:id { rev, status: "active" }`, guarded
like every write, and `POST …/chapters` with `status: "active"` — sets the
previously active chapter to `planned` in the same transaction, and that
chapter's `rev` moves along.

In the chapter overview the status display is the control (as with the scene
status, shared markup in `app/src/components/StatusMenu.tsx`): every
selection patches the chapter, selecting the value already shown writes
nothing. On mobile the status stays a display: below `md` the route renders
the start screen instead of the chapter overview.

### The location of a scene lives in one column

The location of a scene lives in exactly one column, `location`; there is no
group beside it. `location` is a location id or empty
(`decisions/constraints`). Nothing is derived from `location`: neither the
scene's URL nor a grouping.

### The DM sets the order of scenes

A chapter has a scene order, and the DM sets it. `scenes.pos` is this order,
consecutive within the chapter, maintained via up/down on the row. The
chapter overview shows exactly that: one continuous list without location
groups, the location appears by name in the scene's meta line. Contingency
scenes are a block of their own at the end, the same `pos` run, only shown
separately.

- **Read:** `ChapterNode.scenes: SceneSummary[]`
  (`shared/src/campaign-tree.ts`), sorted by `pos, id`. Besides the location
  id, `SceneSummary` carries the resolved location name (`locationName`).
- **Write:** `PUT /api/campaigns/:campaign/chapters/:chapter/scene-order`
  with `{ scenes: string[], rev }`. `scenes` is the complete new order; if it
  is not exactly the set of this chapter's scene ids — one missing, one
  duplicated, one belonging elsewhere — that is 400, and nothing is written.
  The write rewrites the positions densely.
- **The guard is `chapters.scene_order_rev`,** a counter of its own that
  counts only the writes of this list and that `ChapterNode` delivers; the
  `rev` in the body is its. A stale state is 409 `rev_conflict`. The write
  moves `scene_order_rev` and `campaigns.version` — neither `scenes.rev` nor
  `chapters.rev`.
- **New scenes land at the end** of their chapter. If a scene changes
  chapter, it lands at the end of the target chapter.
- **The scenes of a generator run** stand at **the run's start value + the
  scene's number in the outline**, so that the run's order holds even across
  several partial applies in any order. `pos` is a sort key and tolerates
  gaps.
  - The number is the scene's index among the outline's scene parts. A
    discarded or failed scene keeps its number and leaves a gap; a retry does
    not change the number.
  - The start value is the chapter end at the run's **first scene apply**. It
    is stored on the job in the same commit (next to the outline, so it
    survives a restart) and never recomputed for this run. A scene the DM
    creates by hand between start and first apply thus stands before the run;
    a new chapter starts at 0.
  - **Manual sorting wins.** Together with the start value the job stores the
    chapter's `scene_order_rev`. If that has moved since, every further apply
    of this run appends to the chapter end like any other new scene.
  - A tie (the DM creates a scene in the middle of the review) resolves via
    the sort `pos, id`.
  - Applying everything in one call yields the same order. No apply moves
    `scene_order_rev`, `chapters.rev` or the `rev` of an existing scene. A new
    run gets its own start value; there is no sorting across runs.
- **The session view reads the same order.** It opens the first scene whose
  status is neither `played` nor `dropped`, otherwise the first; below the
  open scene stands the step „Nächste Szene: <Titel>" (next scene: <title>).
- **`pos` is not a field of the scene.** It is not in the scene's type, not in
  the fixtures and not in the properties dialog. Order lives in a `pos`
  column: `scene_npcs.pos` holds that of a scene's NPCs, `chapters.pos` that
  of the chapters; none of them is a property.

The chapter thus has three write paths with three guards: the scene with
`scenes.rev` (its fields including the text), the chapter with `chapters.rev`
(title, status, chapter text) and the order with `chapters.scene_order_rev`.

## Why

**One value, one source.** A group beside `location` would be a second value
for the same thing: if the DM corrects the location, the group would remain,
and the display would contradict the field. A derived column, too, would have
obliged every write path to update it. Two sources for one truth always
drift; the repair is to abolish one. The same holds for the order: it has
exactly one source, `pos`.

**Set, not derived.** An order by id or location name would fall out
incidentally instead of being set. The id arises from the typed name and is
fixed afterwards; the name is dramaturgy, and whoever names dramaturgically
does not sort. What would remain is turning ids into numbers (`01-ankunft`) —
an order that becomes wrong at the first rearrangement. The chapter overview
is the tool of preparation, and preparation means: in which order do I tell
this. The location is a property of the scene, not an outline level above
it; two scenes at the same location can lie far apart dramaturgically.

**The whole list.** An order is a statement about a set; a reordering always
changes several positions. Accepting a partial list without positions would
mean sorting the rest somewhere. Up/down has the complete list at hand
anyway. The one partial list with explicit positions is that of a generator
run. An "at the end" recomputed per apply would move along, and an earlier
scene applied later would land at the back again; a new start value after a
manual sort would only sort around the DM's order again.

**A guard of its own.** The order belongs to the chapter but is not the
chapter. With `chapters.rev` as its guard, a reordering would drive an open
chapter text into a 409 and vice versa — conflicts over things that do not
contradict each other. A guard that fires on unrelated writes trains the
user to click the conflict line away, and then does not catch the real
overwrite. A guard therefore counts only the writes it protects against.

**No position field.** Fields are what a scene states about itself. Where it
stands in a list is what the list states about it. A position number in the
properties dialog would moreover be unusable.

**Up/down instead of drag and drop.** Up/down is the same operation with
keyboard and pointing device, not broken on the phone, needs no library and
no grab handle that fights the "calm list" from
[docs/UI-BRIEF.md](../UI-BRIEF.md). Drag and drop would later be another
gesture on the same endpoint.

**One active chapter on the field.** If the rule hung on an endpoint, the
properties dialog would be a second door around it.

## Consequences

- Not part of the decision: an order across chapter boundaries (the chapters
  have their own, `chapters.pos`) and sorting by status, tag or location as a
  view — the chapter overview filters, it does not reorder.
- Campaign knowledge follows the same pattern with a guard of its own
  (`decisions/resources`).
