# LLM generator

## Decision

- **Review before anything is written.** The generator never writes into the
  campaign directly. What a run proposes waits in its job until the DM
  applies it, and a proposed scene is a draft. Flow and prompts are described
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
- **Applying** writes the named proposals in one transaction under the same
  rules as creating their entities. What is applied becomes an ordinary row;
  discarding the job takes only the open remainder. A chapter the run creates
  is recorded on the job and created on the first apply.

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
- A text with prepended fields that is carried through job and review and
  taken apart again on apply can only lose values.
- Parts let a long run deliver early and let one failure cost one call
  instead of the whole run.

## Consequences

- When an entity's shape changes, stored jobs carrying the old shape are
  deleted by the migration instead of converted: a run costs a few tokens, a
  half-converted proposal a wrong row.
- Two tabs are a conflict to report, not one to merge. There is no undo
  history.
- Where applied scenes stand in their chapter follows `decisions/scene-order`.
