# LLM generator

## Decision

- **Review before anything is written.** The generator never writes into the
  campaign directly. What a run proposes waits in its job until the DM
  applies it. Flow and prompts are described
  in [generator/README.md](../../generator/README.md).
- **The provider sits behind an interface.** The Claude API is the default;
  an OpenAI-compatible endpoint is the alternative.
- **Every model response is schema-enforced JSON.** An entity's response
  schema is derived from its zod schema (`decisions/resources`) in the
  providers' strict form and carries only the shape; what the model must know
  beyond the shape is stated in the prompt and checked by validation.
- **Repair, then validate, then correct.** A deterministic JSON repair runs
  before validation; validation errors go back to the model as a limited
  number of correction turns. References a response introduces must name
  something that exists in the campaign or in the same run.
- **No text intermediate format.** From the model's response to the row, a
  proposal is its entity's type. Nothing assembles fields into a text and
  parses them back out.
- **Jobs run on the server and are rows,** at most one per campaign. Starting
  answers immediately; the app polls. Nothing depends on an open tab or
  connection. A finished job survives a restart and stays applicable; a job
  interrupted by a restart is reported as failed.
- **A scene run is a pipeline of parts:** an outline call decides which
  scenes exist, then each scene and each new NPC or location is a call of its
  own. The outline is internal and not offered for editing. Each finished
  part can be reviewed and applied while others still run, and a failed part
  can be retried on its own.
- **The review state lives on the job,** not in the browser: the DM's edits
  and decisions are stored per entity and id and written back as they happen.
  The job has its own guard (`decisions/writes`).
- **The review walks in reference order.** A scene run is reviewed in
  stages: first the new locations, then the new NPCs, then the scenes that
  name them. Each proposal is decided on its own; the stage the DM stands on
  is part of the review state on the job. The scene stage opens only when
  every location and NPC of the run is decided, and going back stays
  possible.
- **Notes belong to what they are about.** What the model notes about one
  proposal, and what the naming check finds in it, is stored and shown with
  that proposal, at the place it names, and goes with it once it is decided.
  Only what concerns the run as a whole belongs to the run, and it stays
  until the job is done. What the server itself notes about a reply (that it
  had to be repaired, that a scene lacked its source passage) is data beside
  the model's notes, which the app says in the DM's language; the server
  writes no sentence of its own, and only a model note is answered.
- **Answering a note patches the proposal instead of generating it again.**
  The DM answers the model's notes on one proposal; the model then returns
  operations on that proposal — a field set, a block replaced, inserted
  after or removed by a literal anchor, or a note — never the proposal
  again. The server applies them deterministically and turns every
  operation it cannot apply unambiguously into a finding that names why —
  data, which the app says in the DM's language. The DM
  takes or discards each applied change on its own, and a taken change is one
  of the DM's edits of the proposal.
- **A run may propose changes to existing rows.** When the DM starts a scene
  run with the option to extend, the run may also name npcs and locations
  the campaign already has and the source material adds to. Such a proposal
  is operations against the stored row, the same operations that answer a
  note, never the entity again; the DM takes or keeps each change on its
  own. Accepting applies the taken changes to the row as it is stored at
  that moment, in one write, and a change that no longer applies there
  changes nothing and is a finding. It is decided in the stage of its
  entity, and it does not hold back a scene that names it, because the row
  exists. A run never changes an existing scene or a chapter's text.
- **Applying writes exactly what is named.** Accepting a proposal writes that
  proposal, in one transaction under the same rules as creating its entity,
  and nothing else. A scene is applied only once every location and NPC of
  the run that its fields name exists; otherwise the server refuses it and
  writes nothing. A mention in the text never blocks. What is applied becomes
  an ordinary row; discarding the job takes only the open remainder. A
  chapter the run creates is recorded on the job and created on the first
  apply.

## Why

- A run costs money and minutes. Bound to a tab or a connection, a
  navigation would destroy a paid-for result; a deploy between finishing and
  applying must not lose it either. Hence server-side jobs as rows.
- The review is the DM's own work and must not be more volatile than the
  result it edits; a second store in the browser is ruled out
  (`decisions/scope`).
- Local and compatible endpoints often ignore the requested response format;
  their errors are mechanical, and a deterministic repair is far cheaper
  than a correction round that resends the whole prompt.
- Fields assembled into a text and taken apart again can only lose values.
- Parts let a long run deliver early and let one failure cost one call
  instead of the whole run.
- A scene is only playable when what it names exists. Deciding the things a
  scene references before the scene itself makes every write the DM's own
  choice: nothing enters the campaign because something else was accepted,
  and no scene points at a row that was never written.
- A note in a pooled list above the review has to be matched to its proposal
  by the DM, and it keeps standing after that proposal is decided.
- A source that adds to a known npc or location is the moment the DM has the
  material at hand; augmenting each row by hand afterwards is work the run
  already did. Changes rather than a whole entity keep what the DM wrote,
  and applying them to the row as stored lets the DM edit it while the
  review waits.
- A proposal written again from the answers can change anything, including
  what the DM already edited or checked; the DM would have to review it
  whole a second time. Operations touch only what they name, cost a
  fraction of the tokens, and can be shown and decided one change at a
  time.

## Consequences

- When an entity's shape changes, stored jobs carrying the old shape are
  deleted by the migration instead of converted: a run costs a few tokens, a
  half-converted proposal a wrong row.
- Two tabs are a conflict to report, not one to merge. There is no undo
  history.
- Where applied scenes stand in their chapter follows `decisions/scene-order`.
- A failed part of a location or NPC keeps its stage open until it is retried
  or the job is discarded.
- An operation whose anchor does not name exactly one block changes nothing;
  the DM reads the finding and answers again or edits by hand. A change that no
  longer applies to the proposal as the DM has edited it since is refused
  instead of guessed.
- A scene that names a rejected proposal cannot be applied as it stands:
  the DM accepts the proposal after all, removes the reference, or drops the
  scene.
