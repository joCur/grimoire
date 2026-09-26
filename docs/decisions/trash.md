# Deleting goes to a trash

## Decision

- **Deleting content is reversible for a fixed time.** Deleting an entity in
  which the DM prepares or captures content puts it in a trash instead of
  removing it. It stays there for a retention period and is then removed for
  good by a purge that the server runs on its own. Lines the DM maintains in
  place on the page that shows them, and records of play, keep their direct
  removal.
- **The trash is a state of the row.** A row in the trash keeps its id, its
  fields, its references and its place in any order; what marks it is the
  moment it went there, stored on the row and, for an entity that goes to
  the trash on its own, a field of the entity like any other. Putting a row
  in the trash is its `DELETE`, taking it out is a write of that field on its
  resource, and the trash is read as a filter on the entity's list
  (`decisions/resources`). Both are guarded writes (`decisions/writes`).
- **A row in the trash is absent for everything but the trash.** Reads,
  lists, orders, the search index, references in text, the generator's
  context and every write that names it treat it as if it did not exist.
  Only its id stays taken: nothing else can be created under it, and nothing
  fills it.
- **Nothing live may name a row in the trash.** A row that something live
  still references cannot go to the trash, and a row that references
  something in the trash cannot come back. The refusal names the rows in the
  way, and nothing is written.
- **A parent takes its dependants along.** A row that goes to the trash takes
  the rows that cannot exist without it, in the same write and at the same
  moment, and its restore brings back exactly those. A dependant restored on
  its own returns at the end of any order it stands in; one that returns with
  its parent keeps its place.
- **Invariants hold across a restore.** A row that comes back must not break
  a rule that holds among live rows; where it would, the restore yields to
  what the DM did in the meantime.

## Why

A single user deletes by mistake as easily as on purpose, and there is no
undo history (`decisions/generator`) and no backup feature
(`decisions/sqlite`). A trash makes deleting safe without asking for
confirmation at every step, and a fixed retention keeps it from growing into
an archive nobody maintains.

Keeping the row and marking it, rather than moving it elsewhere, keeps the
foreign keys intact (`decisions/constraints`): the references a row had are
still valid when it comes back, and the database still guarantees them.
Keeping the id taken is what makes that safe — a new row under the same id
would make the old references point to something else, and filling a row in
the trash would bring back content the DM had discarded.

Refusing instead of cascading follows from the rule that a reference names a
row that exists: silently taking along everything that mentions a row would
delete far more than the DM chose, and silently leaving a live row pointing
into the trash would show something that is gone. Naming what is in the way
lets the DM decide.

A purge that runs on its own keeps the retention true whether or not the
server restarts, and needs no action from the DM.

## Consequences

- Every read of content filters out rows in the trash; a new read path has
  to do the same, and a new referencing relationship has to be checked on
  both the way into and the way out of the trash.
- The purge removes rows in an order the foreign keys accept. Because a row
  can only go to the trash once nothing live names it, and can only come
  back once nothing it names is in the trash, a referencing row never
  outlives the row it references in the trash.
- A new entity that can be deleted decides whether it gets a trash; one whose
  deletion loses content the DM wrote does.
- Every trash and restore is a write and moves the campaign's version counter
  (`decisions/polling`); so does a purge that removed rows.
