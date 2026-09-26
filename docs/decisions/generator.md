# LLM generator

## Decision

The generator is a pipeline with a review step: it never writes directly into
the campaign. What a run proposes waits in the job until the DM applies it; a
proposed scene is always at `status: "draft"`. The flow, prompts and few-shot
examples are described in [generator/README.md](../../generator/README.md).

### Provider and response

- The provider sits behind an interface (`server/src/llm-provider.ts`): the
  default is the Claude API, `LLM_PROVIDER` switches to an OpenAI-compatible
  endpoint (`lmstudio`, `openai`, `openrouter`).
- **Every model response is a schema-enforced JSON object** — the outline its
  own (`shared/schema/outline.schema.json`), a call for an entity that
  entity's response schema.
- **`jsonrepair`** (pinned exactly) repairs every response deterministically
  before validation. The validation rules stay untouched, and a repaired run
  carries a warning.
- After generation a mechanical validation checks the response; errors go
  back to the model as a correction turn. `LLM_CORRECTION_TURNS` sets how many
  a run may spend: 0–2, default 1.
- **An entity's response schema is its type without `rev`** in the providers'
  strict form, derived from its zod schema with `z.toJSONSchema`
  (`decisions/resources`): nullable instead of optional,
  `additionalProperties: false`, every field in `required`, no `pattern`, no
  `format`, no bounds. The schema carries only the shape, no `description`;
  what the model must know about the fields and the schema cannot say is
  stated in their prompt under `generator/` and checked in the validation. A
  test checks exactly the strict-mode rules on the derived schemas.
- **Every `[[id]]` in a generated text** names an NPC, location or scene of
  the campaign or a proposal of the same run (the outline of a scene run, in
  the NPC run the NPC itself) — otherwise the response goes back as a
  correction turn. The rule applies to scenes, NPCs and locations in a new run
  and in an augment run, there only to references the proposal newly brings:
  a reference in the existing text belongs to the DM. It is read with the
  grammar of display and search (`shared/src/refs.ts`): only a kebab-case id
  in double brackets, nothing in code. The text is checked; `motivation` and
  `atmosphere` show an `[[id]]` without a row as text. This is a rule for the
  model's response, not a reference: „Übernehmen" (apply) and the write path
  do not check it.

### No Markdown intermediate format

A proposal is, from the model's response to the row, its entity's type
without `rev`. Nowhere does the server assemble a text with prepended fields
or read one back: the response delivers the fields, the validation reads
them, the review step shows them, and the write layer receives them
unchanged. The existing state that an augment run shows the model is prompt
formatting and is built where the prompt is built
(`server/src/llm-provider.ts`) — not a storage format. Nothing in the repo
parses fields out of text; there is no frontmatter parser and no YAML
dependency.

### Jobs run server-side and are rows

Every operation that can take longer than a few seconds runs as a
server-side job: the start answers immediately with the job, status and
result are polled, and the UI fully restores the state after navigation,
reload or closing the tab. Nothing is bound to an open browser tab or an open
HTTP connection.

- Jobs are rows of the `generate_jobs` table, **at most one per campaign**;
  the list `GET …/generator-jobs` is empty or has exactly one entry.
- `POST …/generator-jobs { kind, … }` starts a scene or NPC run. An augment
  run hangs on its resource: `POST …/<resource>/:id/augment` starts it and
  answers with its job, `POST …/<resource>/:id/augment/apply` applies it. Its
  proposal is the read state next to the proposed one, both in the entity's
  type without `rev`.
- A job result lists `scenes`, `npcs` and `locations` as separate typed
  lists, each in its entity's type without `rev`. Reviewing, deciding and
  applying happen per entity and `id`.
- **Restart:** A finished job (`done`/`failed`) survives it completely —
  result, error body and review state — and stays applicable. A running one
  cannot, because its provider call dies with the process: boot writes every
  leftover `running` row to `failed` (`failInterruptedJobs` in
  `server/src/db/job-boot.ts`), with 503 and the code `job_restarted` in the
  error body, instead of sending the app into endless polling.

### A scene run is a pipeline of parts

An outline call determines which scenes exist; the outline is an internal
step and is never offered to the DM for editing. After that, every scene and
every new NPC or location is a call of its own, three at a time. NPC and
augment runs are single-call runs without parts.

- The row carries the outline, the parts with a status per part
  (`pending | running | done | failed`), error text and token usage per part,
  and the run's token and call totals (column `pipeline`), plus the run's
  source text, because a part restart must send the same excerpt again.
- **A finished part can be reviewed and applied immediately,** while others
  are still running: the job stays `running`, the result fills up, and the
  review page shows parts in outline order. The job becomes `done` as soon as
  one part has produced something, and `failed` only if not a single part got
  through. Applying therefore requires not a finished job but a result: it is
  409 for a failed run and for one that has no finished part yet.
- On restart, running and pending parts become `failed`; finished parts
  remain and stay applicable.
- **„Erneut versuchen" (retry) per part:** `PATCH
  …/generator-jobs/:id/parts/:key { status: "running" }` restarts exactly this
  part, from the stored outline, in **one transaction** over the freshly read
  row that touches only this part — writing back the whole `pipeline` column
  would overwrite a sibling part that has finished in the meantime. A part
  still `pending` is 409: it belongs to the run's pool and would otherwise run
  twice.
- Where the applied scenes stand in the chapter is governed by
  `decisions/scene-order`.

### The review state lives on the job

Everything the DM does in the review step — editing fields and text,
accepting or rejecting proposed NPCs and locations, taking scenes out of the
run, taking or keeping per field — lives in `generate_jobs.review`, not in the
browser. The app reads its state from the job and writes every change back:
text input debounced (~600 ms) and at the latest on leaving the field,
decisions immediately.

- The DM's changes are stored **per entity and id** (`sceneEdits`,
  `npcEdits`): a change names the fields it sets, `null` clears an optional
  one, and every other field keeps the model's value.
- Reviewing and applying use `PATCH …/generator-jobs/:id { rev, … }`. The job
  has its own `rev`; a stale one is 409 `rev_conflict` with the current job,
  and the app reloads instead of silently overwriting another tab's decision
  (`decisions/writes`).
- **Applying** means naming proposals in `review.writtenScenes`,
  `writtenNpcs` or `writtenLocations`. It writes exactly these in one
  transaction (conflict check inside it, search index and references follow)
  and records them on the job in the same commit. It is no way around the
  write rules (`decisions/writes`), and an applied scene takes along the
  proposals it names (`decisions/constraints`). If nothing is left open, the
  job is complete, and the response is its final state.
- **Discarding** (`DELETE …/generator-jobs/:id { rev }`) stops the open parts
  and takes only the open remainder with it. What was applied is a row of the
  campaign and not part of the job; it is edited further in the normal editor.
- There is no undo history and no merging of two editors.

### The chapter of a „Neues Kapitel" run comes from the run

- The title is recorded on the job at start
  (`generate_jobs.new_chapter_title`), and the first apply creates the chapter
  from it — idempotently and in the same operation as the scenes, even if no
  applied part names it: the chapter belongs to the run. A generated scene
  gets its chapter in the same write; if the chapter id is not a slug, that is
  400.
- The outline carries `chapterDescription` (nullable). Only the outline call
  of a run that creates its chapter learns this (context line
  `neues Kapitel: ja`) and describes the chapter from the source material.
  „Entwürfe prüfen" (review drafts) shows the description read-only, and
  applying creates the chapter with it as `body`. For a run into an existing
  chapter the validation discards the field, and the text of a chapter that
  already exists at apply time stays untouched. If the description is
  missing, the chapter starts with empty text; that costs no correction turn.
- In the dialogs, a chapter the DM types must exist (400
  `chapter_unknown`): there an unknown chapter is a typo.

## Why

- A run costs money and minutes. If it is bound to a tab or a connection, a
  browser back or a space switch destroys a paid-for result; that must be
  impossible by construction. A deploy between "done" and „Übernehmen" must
  not throw away a result either, which is why the job is a row.
- The review step is work the DM puts in themselves; it must not be more
  volatile than the result it edits. A second store in the browser is out of
  the question (`decisions/scope`).
- An endpoint that accepts and ignores `response_format` still delivers
  hand-written output, and there the errors are mechanical (trailing comma,
  single quotes): a deterministic repair is much cheaper than a correction
  round that resends the whole prompt.
- A text with prepended fields that is carried through job and review step
  and taken apart again on apply can only lose: a field that comes back
  differently as YAML (a date, a `+2`, a colon in a sentence), a block that
  degrades when parsed.
- A run's chapter must not live in the browser: the apply regularly happens
  after navigation or reload.

## Consequences

- If the shape of an entity changes, stored jobs whose payload carries it in
  the old shape are not converted: the migration deletes them via SQL. A run
  costs a few tokens, a half-converted proposal a wrong row in the campaign.
- Two tabs are a conflict to report, not one to merge.
