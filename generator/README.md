# Generator

Pipeline: source text (EN) → LLM → proposed scenes (DE) → review → database.

## Reply formats

**Every reply is a JSON object, and every object is enforced by a schema.**
That is the whole contract: the provider sends the schema along and the
interface guarantees the shape before the server reads it.

* **Claude**: the schema travels as a tool, `tool_choice` forces the call;
  the reply is the tool input.
* **OpenAI-compatible**: `response_format: { type: "json_schema", …, strict:
  true }`, with **one** fallback to `json_object` when the endpoint answers
  400. The fallback is remembered (once per process, so the detection is paid
  for once) only when the error text names the format (`response_format`,
  `json_schema`, `schema`) or the plain attempt succeeds — a 400 for another
  reason (prompt too long, wrong model id) propagates unchanged instead of
  switching the enforced shape off for good.

**Scene, NPC and location replies.** Scene, NPC and location are each their
own resource with their own type (decisions/resources). The scene part and
the scene augment reply with the scene itself without `rev`, the NPC part,
the NPC run and the NPC augment with the NPC, the location part and the
location augment with the location — all fields side by side, `body` one of
them — plus `warnings`. A scene:

```json
{
  "id": "night-watch-quay",
  "title": "Nachtwache am Kai",
  "type": "planned",
  "trigger": null,
  "chapter": "01-salzhafen",
  "location": null,
  "npcs": [],
  "handouts": [],
  "tags": ["social"],
  "status": "draft",
  "body": "## Flow\n\nDie Wache murrt: „Wer nachts hier steht, hat was zu verbergen.“\n",
  "warnings": ["Der Quelltext nennt keinen DC — DC 13 gesetzt."]
}
```

For an NPC, `quickstats` travels as a **list** of `{ "key": …, "value": … }`,
the value always a string:

```json
{
  "id": "grella",
  "name": "Grella",
  "role": "Schmugglerin mit eigenen Plänen",
  "chapter": null,
  "status": "alive",
  "statblock": null,
  "quickstats": [{ "key": "insight", "value": "+3" }],
  "voice": null,
  "appearance": null,
  "motivation": "Die Route durch die Nordbucht für sich allein.",
  "body": "## Weiß\n\n> [!secret] …\n",
  "warnings": []
}
```

A location:

```json
{
  "id": "alte-mole",
  "name": "Die alte Mole",
  "chapter": null,
  "roll20Page": "Mole",
  "atmosphere": "Salz in der Luft, Möwen über dem Schlick.",
  "body": "## Beim ersten Betreten\n\n> [!readaloud] …\n",
  "warnings": []
}
```

The fields are typed **per entity** — a model can write exactly the fields
the DM can edit, and no more. Nothing assembles a Markdown text from a reply
and nothing reads one back, so nothing can lose a value on the way. A
proposed scene is the scene without `rev` (`SceneProposal`), a proposed NPC
the NPC without `rev` (`NpcProposal`), a proposed location the location
without `rev` (`LocationProposal`); a job lists them under `result.scenes`,
`result.npcs` and `result.locations`, and reviewing, deciding and accepting
run for each through its `id`. When the DM changes a proposed scene or a
proposed NPC in the review, the change lies next to the proposal as
`sceneEdits[<id>]` or `npcEdits[<id>]` and is laid over it on accepting.

The reply schemas of scene, NPC and location have **exactly one source**:
their zod schema (`shared/src/scene.ts`, `shared/src/npc.ts`,
`shared/src/location.ts`). From it each entity derives its generator shape
itself, with zod's API (`sceneReplySchema`, `npcReplySchema`,
`locationReplySchema`: the entity without `rev`, the optional fields
nullable instead of optional, for the NPC `quickstats` as a list of pairs,
plus `warnings`, nothing additional allowed), and `sceneReplyRequest` in
`server/src/scene-reply.ts`, `npcReplyRequest` in `server/src/npc-reply.ts`
and `locationReplyRequest` in `server/src/location-reply.ts` hand it to the
provider via `z.toJSONSchema` — per run under its own name (`scene`,
`augmented_scene`, `npc`, `augmented_npc`, `location`,
`augmented_location`). For the scene the runs also differ in shape: a
**new** scene can only be `draft` (`newSceneReplySchema`), an existing one
keeps the status the DM gave it. The schema carries no `description`: what
the model must know about the fields (the id rule, which chapter id `chapter`
may name, what `motivation` or `atmosphere` is, the shape of `quickstats`,
`body` and `warnings`) is in the entity's fields file (`scene-fields.md`,
`npc-fields.md`, `location-fields.md`, see "Prompt files"), and the augment
and patch runs load exactly that file. The outline loads its
schema as readable JSON from `shared/schema/outline.schema.json`;
`shared/test/reply-schema.test.ts` checks the rules of strict mode for
**every** schema, derived or loaded.

**The prompts show exactly this object.** Every entity's fields file carries
a ```json example of the reply object: the fields side by
side in the same order as the entity's schema (an optional field without a
source as `null`), `body` as **one** string — its structure, `## Flow`,
`## If:`, the six callouts and `[[id]]` references, is described below it as
a description of that string — and `warnings` as a list of strings. Prompt,
schema and few-shot thereby show the same shape, field by field.

Three quirks of **strict mode** (the OpenAI path sends `strict: true`, and a
rejected schema is a lasting fallback for the whole process):

* no `pattern`, no `format`, no `min*`/`max*` bounds — what the schema cannot
  say is in the entity's prompt (for the outline in a `description`) and is
  checked where it is checked anyway (kebab `id`, known callouts, resolvable
  references),
* **all** fields are in `required`; a truly optional field is nullable
  instead, and the server reads `null` as "not given" and leaves the key out,
* a free key/value map (`quickstats`) cannot be expressed at all, so it
  travels as a **list** of `{ key, value }`, and `npcFromReply` folds it back
  into the NPC's quick stats.

Why not a scene as **one** Markdown text as the reply? Because that would
trade JSON escaping for **text parsing**: a code fence around it, a sentence
before it, a closing sentence after it, two horizontal rules that look like
fields. No API can guarantee that half, so it would have to be tolerated by
hand — and every miss is a correction round or silent data loss. An enforced
object can do none of that: the **transport** escapes the `body`, which is
why a `„…“` whose closing character is the ASCII `"` survives the transfer
character by character.

**The tolerant reader** stays as a net for endpoints that accept the field
and ignore it (`parseJsonReply` in `server/src/json-reply.ts`, used by every
reply): the whole text, then a ```json fence, then the span from the first
`{` to the last `}` — and **one** deterministic repair (`jsonrepair`, pinned
exactly) for a trailing comma or single quotes. After that it is **validated
as usual**: the repair loosens parsing, never the rules. A repaired reply
earns a server note (`reply_repaired` in `serverNotes`, beside the model's
`warnings`), which the app says in a sentence, so that a provider that needs
patching every time is visible. Prose without an object is *not*
repaired: `jsonrepair` would turn a sentence into a JSON string, and the run
would then fail with a message about the wrong thing.

The **correction round** names the schema in which to correct
(`buildCorrectionMessage`), so that the model stays in the shape it was
given. Nothing else is corrected afterwards: no typography heuristic, no
silent replacement.

**The outline** has its own schema (`shared/schema/outline.schema.json`), the
only one that describes no entity: a small flat object of the scene list,
the list of new NPCs (`npcs`), the list of new locations (`locations`) and,
for a new chapter, its description. The **semantic** checks stay where they
are: a schema cannot say "this id occurs only once in the whole run", "this
reference in `refs` is a scene of THIS outline" or "the chapter comes from
the context".

**The few-shots are replies**: `example-output.json`,
`npc-example-output.json`, `location-example-output.json` and
`outline-example-output.json` show exactly the object the respective call is
forced into.

## Prompt files

Each entity describes its fields in a file of its own — `scene-fields.md`,
`npc-fields.md`, `location-fields.md` — the one place they are described.
The server composes every system prompt from whole files, joined in a fixed
order with one blank line between them (`ASSET_FILES` and `composePrompt`
in `server/src/generator.ts`); no code looks for a heading inside a file.

| Prompt | Files, in this order |
|---|---|
| scene (one scene of an outline) | `system-prompt.md`, `scene-single-output.md`, `scene-fields.md`, `scene-rules.md` |
| NPC (NPC run and NPC part) | `npc-system-prompt.md`, `npc-fields.md`, `npc-rules.md` |
| location (location part) | `location-system-prompt.md`, `location-fields.md`, `location-rules.md` |
| outline | `outline-system-prompt.md`, and `outline-extend-rules.md` for a run that may extend |
| scene / NPC / location augment | `scene-augment-system-prompt.md` / `npc-augment-system-prompt.md` / `location-augment-system-prompt.md`, then the entity's fields file |
| patch | `patch-system-prompt.md`, then the part's entity's fields file |
| extension | `extend-system-prompt.md`, then the entity's fields file |

A create prompt thus reads as one document: who the model is and what it
answers with, the entity's fields, then the rules and the worked example.
An augment or patch prompt brings its own output format and its own rule,
and from the entity only its fields — never a second output format or the
create rules.

## Flow of a scene run (pipeline)

A scene run is not **one** call but `1 + N (+ proposals)`:

1. **Outline** (one call, `outline-system-prompt.md` +
   `outline-example-output.json`): small JSON, enforced by schema (see
   "Reply formats") — with the scene list: `id`, `title`, `type`,
   `location`, cross references (`refs`) — and one list each of new NPCs
   (`npcs`) and new locations (`locations`), each entry
   `{ id, name, summary }`. Each scene also names the **first and last
   sentence of its source section verbatim** (`sourceExcerpt`); the server
   cuts the section out of the source text with them. If it does not find the
   quotes verbatim (whitespace is normalised, nothing else), the scene gets
   the **whole** source text and its part a note — more expensive, but
   never wrong. Validation and correction turns apply to this step alone.

   **New chapter:** when the run creates its chapter, the context of the
   outline call carries the line `neues Kapitel: ja`, and the outline
   describes the chapter under `chapterDescription` — one to three sentences
   from the source text about what the chapter is about and what the group
   should achieve. The review shows it as the chapter's description, and
   accepting creates the chapter typed — as a `Chapter` without `rev`,
   `planned`, with the description as `body`. For an existing chapter the
   field is `null`, and whatever is there anyway is discarded by validation:
   no run reaches the text of an existing chapter. A missing description
   costs no correction turn — the chapter then starts with an empty text.

   **Extending what exists:** a run started with `extend` may also name NPCs
   and locations of the context the source text adds to, in
   `existingNpcs` and `existingLocations`, each entry `{ id, summary }`.
   The system prompt then carries `outline-extend-rules.md`, and the schema
   the two lists; a run without the option sends neither and reads neither.
   Every id of the run, these included, occurs once.

   **Limit:** at most 12 scenes and 12 NPCs and locations — new and extended
   — together per run (`MAX_OUTLINE_SCENES` / `MAX_OUTLINE_PROPOSALS`). Every part is a
   provider call, so the outline decides what a run costs; above that the
   reply is a validation error and thus a correction turn that asks for
   merging — not a failed run.

   The outline is a **purely internal** step to reduce errors. It is never
   shown to the DM and never offered for editing — what matters is the
   result per scene, NPC and location and the description of a new chapter.
   The server stores it on the job row, because a retry and a restart need
   it.

2. **Scenes** (one call per scene, concurrency 3): the scene prompt, whose
   output section `scene-single-output.md` writes exactly one scene from the
   outline (see "Prompt files") + outline + the cut source section. Output: exactly one scene object. Validation,
   correction turns and the naming check **per scene**; a failed part does
   not block the others.

3. **Proposals** (one call per new NPC and per new location):
   the NPC's or the location's create prompt, with the outline
   and the sections of the scenes that name the NPC or play at the location.
   Deduplicated by id.

4. **Extensions** (one call per existing NPC and location of the outline):
   `extend-system-prompt.md` with the entity's fields and
   `extend-example-output.json`, the stored row in its reply form under the
   existing-NPC or existing-location heading, and the sections of the scenes
   that name it or play there. The reply is the list of operations a patch
   call answers with (see "Answering a part's notes"), applied the same way
   to the row the call saw: what applies becomes the part's changes
   (`result.npcExtensions`, `result.locationExtensions`), what does not a
   finding on the part, and a `note` a note on it.

What this gives the DM: a shape error costs only the affected part, finished
parts can be reviewed and accepted right away, and a broken part can be
retried on its own (`PATCH …/generator-jobs/:id/parts/:key { status:
"running" }`). The job model behind it is in `docs/decisions/generator.md`.

**Prompt caching:** the constant part of the prompt — system prompt,
campaign knowledge, glossary, context lists, few-shot, outline — comes
**first** in every call and is marked with `cache_control: ephemeral` for the
Claude provider (one mark each for the system prompt and the constant
block); OpenAI-compatible endpoints cache the same prefix implicitly. Only
the variable rest changes per part: **which scene this call writes**
(`## Diese Szene schreibst du jetzt`), the excerpt, the existing scene, the
existing NPC or location, the instruction. The outline block itself is
**byte for byte identical** for every part of a run — which is why the
assignment is not in it.

The "~N tokens · M calls" display sums over all parts, the outline included.

**Single calls:** the augment runs and the NPC run — one scene, one NPC or
one location each, nothing to split.

## Review of a scene run

The review walks the run in the order its proposals reference each other
(decisions/generator):

1. **Locations** — every new location of the run,
2. **NPCs** — every new NPC of the run,
3. **Scenes** — the scenes that name them.

A stage without proposals is skipped; within a stage the proposals stand in
outline order, and a part that is still running or failed shows in its
stage. The stage the DM stands on is stored on the job (`review.stage`) and
written back as it changes.

Each location and NPC is decided on its own: accepting writes it right away,
rejecting marks it rejected (a rejected one can still be accepted after
all). The scene stage opens only when every new location and NPC is decided;
going back stays possible.

An extension of an existing NPC or location stands in the stage of its
entity, marked as such, with its changes as the comparison a patch round
shows. Each change is taken or kept (`review.keptChanges`, by the part's
key, lists the kept ones); accepting (`writtenNpcs`, `writtenLocations`)
applies the taken ones to the row as it is stored at that moment, as one
write of that row. A block change whose anchor no longer names exactly one
block changes nothing and stands as a finding on the part. An extension
does not hold the scene stage back, and its notes are not answered. Scenes are editable, and accepting a scene
writes exactly that scene.

The notes stand where they belong. What the model noted about one scene,
NPC or location (its `warnings`) travels on that part of the pipeline and
stands under the header of its card, folded from three notes on. A naming
hint stands at the field it names, or at the block of the text its line sits
in — on the card and in its edit mode — and is bound to that place for
assistive technology; a card that shows neither fields nor text (an NPC or a
location row) lists its hints, each naming where it sits. A hint is never a
blocker. A part's notes and hints leave with it once it is written, rejected
or dropped. What the server notes about a part — its reply had to be
repaired, or a scene was written from the whole source text because its
passage could not be matched (`serverNotes` on the part) — stands with the
model's notes as a sentence of the app, and is not answered: the model did
not write it. What the model noted about the run as a whole — the outline's
own notes — and that the outline reply had to be repaired (`serverNotes` on
the result) stand above the stages as one compact block until the job is
done. The NPC
run shows its notes on its one card; an augment run keeps its notes at the
top and puts its hints at the field or block of the comparison.

A scene whose `npcs` or `location` names a proposal of the run that is not
written cannot be written: the server refuses it with a 409
`proposal_not_written` naming the scene and the unwritten NPCs and locations,
and writes nothing. A `[[id]]` mention in the text never blocks. The card of
such a scene says which rejected proposal it names and offers three ways
out: accept the proposal after all, remove the reference (a change in
`sceneEdits`; `null` clears the location), or drop the scene.

## Answering a part's notes

Answering a note patches the proposal instead of generating it again
(decisions/generator). Every model note on a finished scene, NPC or location
part of a scene run gets an answer field on its card; one action sends every
answer of the part (`PATCH …/generator-jobs/:id/parts/:key { rev, round:
{ answers } }`, 202) — one call per part and round, run on the server while
the app polls. The run's own notes and the NPC run's single card are not
answered.

An answer can be kept as campaign knowledge too: a box under each answer
field sends it with `asKnowledge: true`. Opening the round then creates a
`fact` item whose text is the answer on one line — the row `POST
…/knowledge-items` would create, at the end of the order — in the same
transaction, and the round's call reads its context after that, so the fact
is in the knowledge block of this call and of every later one. A refused
round creates nothing; the round stores the answer without the flag, so a
failed round sent again creates no second item.

The patch call is one provider call. Its system prompt is
`patch-system-prompt.md` followed by the entity's fields file; its few-shot is `patch-example-output.json`. The prompt carries the
campaign knowledge, the glossary, the context lists and the run's outline
as every part does, then the proposal with the DM's edits in its reply form
(`## Vorschlag, den du änderst`) and the notes with their answers (`## Hinweise
und Antworten des DM`). The reply is a list of operations, enforced by a
schema derived from the entity's reply schema:

* `set` — one field (any but `id` and `body`) to a new value;
* `replace`, `insertAfter`, `remove` — one block of `body`, named by an
  anchor that quotes the block as it stands;
* `note` — what the model could not do.

The server applies the operations deterministically to the proposal the
model saw. An anchor is compared whitespace-normalized with each block; one
that matches no block or several is not applied. Neither is a field value
that fails the field's schema or names an id outside the run or the
campaign, nor a block text with an unknown callout or reference. Each of
them becomes a finding on the part (`pipeline.parts[].findings`): data that
names its kind and what it is about (the anchor, the field, the ids), which
the app says as a whole sentence in the DM's language; the server writes no
sentence of its own. Nothing else of the proposal moves: an applied block
operation changes exactly that block.

What the round brings stands on the card as a comparison, field by field
and block by block, and the DM takes or discards each change (`PATCH
…/parts/:key { rev, round: { changes: { <id>: "taken" | "kept" } } }`). A
taken change is written into `sceneEdits`, `npcEdits` or `locationEdits`
under the job's guard (a stale `rev` is 409 with the current job); a block
change that no longer finds its block in the edited proposal is 409
`patch_anchor_missing` and writes nothing. The answered notes are gone from
the part once the round returns, and the model's new notes join them; the
findings stand until the next round opens or the part is decided. A
failed round keeps the notes and can be sent again; a restart reports a
round in flight as failed. The token count of the run adds the patch calls.

## Flow per call

Applies to every SINGLE provider call — the outline call, every scene call,
every NPC and location call and the single-call runs:

1. The server gathers context: all npc/location ids + names, chapter id,
   **campaign knowledge** and glossary (both from the database —
   `knowledge_items` and `glossary_terms`).
2. Prompt = the entity's system prompt (see "Prompt files") + its few-shot
   target (`example-output.json` for a scene)
   + campaign knowledge + glossary + context + source text.
3. The LLM replies — with the **entity's object** (scene, NPC, location,
   augment) or with the **outline object**, each enforced by schema; see
   "Reply formats" above.
4. The server validates mechanically (the schema covers the shape, this is
   the content):
   - only known fields, kebab `id`? `type`/`status` valid? New scene:
     `status == draft`, enforced by the schema; `chapter` the run's? NPC:
     `status` one of the four values (normally `alive`), enforced by the
     schema; a location has no `status` field, its schema knows none.
   - do all `npcs`/`location` references exist OR come as a proposal of the
     same run?
   - does every `[[id]]` in the text name an NPC, location or scene of the
     campaign or a proposal of the same run (outline, in the NPC run the NPC
     itself)? In the augment run only references the proposal newly brings
     count; `[[id]]` in code is not a reference.
   - only known callout types?
   No check looks for a heading (decisions/data-shape): `## Weiß`,
   `## Beziehungen` and the like are recommendations of the prompts, free
   text.
   Errors go back to the LLM as a correction turn (configurable via
   LLM_CORRECTION_TURNS, 0–2, default 1), not to the DM. Exception: a reply
   the model cut off (finish_reason/stop_reason) aborts right away —
   correction turns cannot heal a token limit, they only cost.
5. The server checks the finished proposal against the **naming
   conventions** of the campaign knowledge (word boundaries, case
   insensitive, no heuristic) and puts matches as `namingHints` into the job
   result, each naming its scene, NPC or location by id. The model's
   `warnings` about a scene, NPC or location go onto its part of the
   pipeline; the job result's `warnings` are the run's own.
6. The app shows the review (see "Review of a scene run"). Only accepting
   writes into the database.

## Campaign knowledge

Maintained per campaign on `/campaigns/:id/knowledge`, three kinds: naming
convention (`Old → New`), fact, style rule. The prompt puts them **before**
the glossary, under a binding heading:

```
## Kampagnenwissen — immer anwenden, auch wenn das Quellmaterial anders lautet

- Namenskonvention: schreibe „Salt Harbour“ immer als „Salzhafen“.
- Fakt: Der Leuchtturm ist seit zwei Wintern unbesetzt.
- Stilregel: Keine Würfelwerte im Read-Aloud-Text.
```

`[[slug]]` references in the campaign knowledge are resolved beforehand (the
model's text should contain names, not slugs). Without rows the section is
missing entirely.

## German orthography

All system prompts (the create prompts of scene, NPC and location, the three
augment prompts, the patch prompt and the outline prompt) carry **the same**
German-orthography rule:
every real text — prose, read-alouds, callouts, `## If:` conditions,
headings, `warnings` and every field that is text (`title`, `name`, `role`,
`voice`, `appearance`, `trigger`, `statblock` …) — uses ä/ö/ü/ß as exactly
these characters. **The only exception**: `id` values (and `location`, which
is an id) stay kebab-case ASCII; proper names from the source text stay
unchanged.

**The quotation marks belong to it**, as **one** identical sentence in the
same rule: German typographic quotation marks `„…“` (U+201E/U+201C), single
`‚…‘`, and `’` as the apostrophe. Prompts, few-shots, examples and the UI
catalog use them throughout, never U+201E closed by the ASCII character. Two
tests keep it that way: `app/src/i18n/i18n.test.ts` over the catalog VALUES
(in the source the closing ASCII character cannot be told apart from the
string delimiter) and `server/test/typography.test.ts` over prompts,
few-shots and `examples/`.

The rule stands in the create prompts' rules files (`scene-rules.md`,
`npc-rules.md`, `location-rules.md`), in the augment prompts in the augment
rule and in the patch prompt in its rule — so exactly **once** in every
assembled prompt, because an augment or patch prompt takes only the fields
file of its entity, never the create prompt's rules. The server corrects
nothing afterwards:
there is no heuristic and no silent replacement, the rule works in the
prompt alone.

## Tables

The same mechanism as the orthography rule: **one identical table rule** in
all system prompts that write scenes, NPCs or locations — the outline prompt
does not carry it, because it only outputs the outline (it carries the
orthography rule anyway, because titles, one-liners and `warnings` are
text) — in the three create prompts under `## Regeln`, in the augment prompt
in the augment rule, so exactly **once** in every assembled prompt (an
augment prompt takes only the fields file of its entity).

What the rule says: tables from the source material — random tables,
encounter and dice lists — are output as a valid GFM pipe table (header row,
`|---|` separator row, edge pipes) and stand in the matching callout, with
its `>` in every row. **Of GFM the generator uses only this pipe table**:
strikethrough, task lists, footnotes and autolinks stay normal text —
exactly as `app/src/markdown/remark-table.ts` renders them.

The scene few-shot (`example-output.json`) shows a small d6 table in a
`[!note]` callout, so the model sees the shape in the callout instead of only
having it described. Tables stay unvalidated: a broken separator row is
text — degradation instead of an error.

## NPC generator

The same pipeline, its own kind of run (`POST
/api/campaigns/:campaign/generator-jobs { kind: "npc", sourceText, id? }`)
and its own prompt assets (the NPC's create prompt and
`npc-example-output.json` as the few-shot target). Target format: the NPC
from README.md, without `rev`; `[[id]]` only to NPCs, locations and scenes of
the campaign or the NPC itself, quick stats as strings (the plus survives),
`status: alive` as the normal case, `chapter` empty. One generator job per
campaign, whether scenes or NPC. The result is under `npcResult.npc` and is
accepted like every proposed NPC through its `id` (`PATCH
…/generator-jobs/:id` with `review.writtenNpcs`).

An existing NPC is augmented on its resource (`POST …/npcs/<id>/augment`,
accepted with `POST …/npcs/<id>/augment/apply`):
`npc-augment-system-prompt.md` carries the augment rule, `npc-fields.md`
the fields, and the
existing NPC stands in the prompt in the reply shape (`quickstats` as
pairs).

## Provider

Abstraction in `server/src/llm-provider.ts`, chosen by the env var
`LLM_PROVIDER` — no code change needed:

- `claude` (default): the Claude API directly (`ANTHROPIC_API_KEY`, optional
  `CLAUDE_MODEL`).
- `openrouter`: OpenRouter as a model router (`OPENROUTER_API_KEY` +
  `LLM_MODEL`, e.g. `anthropic/claude-sonnet-5`) — one key, many models, so
  they can be compared without rebuilding the configuration.
- `openai`: the same transport for **any** OpenAI-compatible endpoint
  (`LLM_BASE_URL` + `LLM_MODEL`, `LLM_API_KEY` only if required).
- `lmstudio`: local without a key (`LMSTUDIO_URL`, `LMSTUDIO_MODEL`).

The three OpenAI-compatible cases share one class (`OpenAICompatProvider`);
they differ only in base URL, model and auth header. Missing required
variables and an unknown `LLM_PROVIDER` value are not swallowed: starting a
run (`POST /api/campaigns/:campaign/generator-jobs`) answers `503` with the
message in plain text. Full variable table: docs/DEPLOYMENT.md section 2.

## Augmenting scenes

An existing scene is augmented on its resource (`POST
…/scenes/<id>/augment`, accepted with `POST …/scenes/<id>/augment/apply`):
`scene-augment-system-prompt.md` carries the augment rule, `scene-fields.md`
the fields, and the
existing scene stands in the prompt in the reply shape.

## Proposals carry no address

The model delivers **scenes, NPCs and locations**, each as its entity
without `rev`, and none of them has an address:

* Proposed scenes are under `result.scenes`, each with the run's chapter in
  `chapter`, proposed NPCs and locations under `result.npcs` and
  `result.locations`. Each is reviewed, decided and accepted through its
  `id` (`PATCH …/generator-jobs/:id` naming it in `review.writtenScenes`,
  `review.writtenNpcs` or `review.writtenLocations`; the response is the
  job, whose review names what is written). An id that is already taken is
  a 409 `{ chapters, scenes, npcs, locations }` with those ids; a scene that
  names an unwritten proposal is the 409 `proposal_not_written` (see
  "Review of a scene run").
* NPC run and augment run: when augmenting, the target is fixed on the
  server anyway — it is the resource the run hangs on (`POST
  …/scenes/<id>/augment`, `POST …/npcs/<id>/augment`, `POST
  …/locations/<id>/augment`, accepted with `…/augment/apply`).
