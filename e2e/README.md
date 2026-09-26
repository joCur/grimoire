# e2e — the critical paths against the real stack

Playwright suite for the ten critical paths from `CLAUDE.md`. Built app, real
server process on its own SQLite database, real browser. Nothing in the
browser is mocked — the only stand-in is the LLM: a local, OpenAI-compatible
stub (`fixtures/stub-llm.ts`) that the server calls over HTTP through the
normal `OpenAICompatProvider`.

## How the suite seeds

- **Seeding goes through the real tool — `grimoire seed`.** Every test gets
  an empty `GRIMOIRE_DATA` directory; the `server` fixture runs
  `grimoire seed <fixtures-directory>` on it with the pristine copy of
  `fixtures/beispiel` and THEN starts the server (the boot itself loads
  nothing).
- **The fixtures are INPUT**, read once per test. `fixtures/beispiel` holds
  the example campaign as **one JSON per object**, exactly in the shape the
  API speaks. The campaign, a chapter, a scene, an NPC, a location, a thread,
  an idea, a glossary term, a piece of campaign knowledge and a session are
  each their own resource ([decisions/resources](../docs/decisions/resources.md))
  and lie as `campaigns/<id>.json`, `chapters/<id>.json`, `scenes/<id>.json`,
  `npcs/<id>.json`, `locations/<id>.json`, `threads/<id>.json`,
  `ideas/<id>.json`, `glossary-terms/<id>.json`, `knowledge-items/<id>.json`
  and `sessions/<id>.json` respectively: the entity itself, all fields flat,
  without `kind` and without `rev`. A session embeds its children — `pauses`
  and `log`, every row with its own `id`.
- **A test overrides the example campaign per entity**, in its own copy of
  the directory:
  `test.use({ seed: { scenes: [{ id: "loot-check", … }], without: { sessions: ["2026-01-15"] } } })`.
  `campaign`, `chapters`, `scenes`, `npcs` and `locations` carry the entity's
  type from `@grimoire/shared/<entity>` (`CampaignSeed`, `ChapterProposal`,
  `SceneProposal`, `NpcProposal`, `LocationProposal` — the entity without
  `rev`), `sessions` the session without its guards (`SessionSeed` from
  `@grimoire/shared/session`). An object whose `id` the example campaign
  already has REPLACES it, every other one is added; `without` leaves objects
  out per entity by their `id`. Without an override the shared pristine copy
  is used directly (nobody writes into it), so most tests copy nothing at
  all.
- **A reference points at something that exists.** A scene that names a
  location or NPC that does not exist makes the seed run fail
  ([decisions/constraints](../docs/decisions/constraints.md)) — that is a
  fixture bug, not a degradation.
- **An empty instance** — no campaign, the normal case of a fresh
  installation — switches the seed run off: `test.use({ seed: { skip: true } })`
  (path 10).
- **Assertions go through the API** (`api` and the helpers per entity, see
  below); where an assertion really means the storage, through `db`.
- **Every entity answers under its own resource**: the campaign under
  `/campaigns/<id>` (`getCampaign(api)`), a chapter under `…/chapters/<id>`
  (`getChapter(api, id)`), a scene under `…/scenes/<id>`
  (`getScene(api, id)`). There is no general endpoint: every former address
  under `…/entries/*` is a 404.
- **The guard token is called `rev`** (the row version). A stale `rev`
  answers with 409 `rev_conflict` and carries the current state along under
  the entity's name — `campaign`, `chapter`, `scene`, `npc`, `location`.
- **A scene the generator proposes is the scene without `rev`**
  ([decisions/resources](../docs/decisions/resources.md)) — on the wire
  `result.scenes`, each with its `id`, all fields flat. Changes made while
  reviewing travel **per scene and per field**:
  `sceneEdits: { "<id>": { title?, …, body? } }` in the job's `PATCH` and on
  the job; a named field replaces the model's value, `null` empties
  `trigger`/`location`, every other field stays the model's. Discarding and
  writing happen per `id` (`droppedScenes`, `writtenScenes`): accepting is
  the same `PATCH` with `review.writtenScenes`, `writtenNpcs` or
  `writtenLocations` — the ids that get written.
- **The generator job is its own resource**
  ([decisions/resources](../docs/decisions/resources.md)):
  `…/generator-jobs` is the list with the campaign's one job or none
  (`readGeneratorJob(api)`), `POST` starts a run and answers 202 with the job
  itself, `PATCH …/generator-jobs/<id> { rev, … }` reviews and accepts,
  `PATCH …/parts/<key> { status: "running" }` restarts a failed part,
  `DELETE …/generator-jobs/<id> { rev }` discards. The helpers live in
  `support/generator-job.ts`. The former addresses `…/generate`,
  `…/generate/job` and `…/generate/apply` are a 404.
- **A scene has ONE write path**: `PATCH …/scenes/<id>` with
  `{ rev, force?, …subset of the fields }` (`patchScene`). Fields and text
  together are **one** write against **one** `rev` — one step of the row
  version, no matter how much the request carried. A field a scene does not
  have is a 400 that names it. Campaign and chapter write the same way
  through their resource (`patchCampaign`, `patchChapter`). A chapter
  becomes active by its `status` going to `active` — the server sets the
  previously active one to `planned` in the same operation.
- **Conflicts come from the SECOND WRITER**, not from outside: critical
  path 9 writes through the API (`patchScene`, `patchChapter`,
  `patchCampaign`) while the editor stands open, then the UI saves — and has
  to show the conflict line with its two actions instead of silently
  overwriting. The same in `status-control`, `properties-form` and
  `block-composer`.
- **Because all fields of a scene share one row, a pure status write is a
  conflict for an open text editor too.** There is no "text-neutral" change
  that a surface silently takes over.
- **The conflict line is shared** (`EditConflict`) and the **only**
  `role="alert"` of the app — specs therefore reach it by its role, and
  compare its wording only through the catalog: the status control's message
  begins with the same words. Its two actions are the reload action (discard
  the draft, take over the stored state) and the save-anyway action
  (`force`, writes only the fields sent along). The generator's accept step
  cannot force and therefore shows only the reload action.
  Watch out: the save-anyway label contains the save label — whoever means a
  surface's save button writes `{ name: uiExact("common.save") }`.
- **After the reload action the text editor's draft starts on the default
  surface again** (block composer). A spec that reads the textarea
  afterwards switches to the Markdown mode again, without leaving the edit
  mode.

## Scene = its own resource, order = its own list

A scene is its own resource
([decisions/resources](../docs/decisions/resources.md)): it lies flat under
its campaign, its chapter and its location are fields, and the app reads it
under `/campaigns/:c/scenes/<id>`. The chapter overview is one continuous
list in the order the DM sets
([decisions/scene-order](../docs/decisions/scene-order.md)), and the
location stands with its name in the row's meta line. For the suite that
means four things:

- **A scene is addressed by its `id`**, wherever it lies:
  `getScene(api, "lighthouse-arrival")`, `sceneExists(api, id)`,
  `scenePath(api, id?)` for raw calls. Both locations of the example campaign
  exist as their own resource (`…/locations/leuchtturm`, `…/locations/bucht`;
  `getLocation(api, id)`) — a reference creates nothing
  ([decisions/constraints](../docs/decisions/constraints.md)) —, so the
  campaign has **two** locations. Former addresses like
  `…/entries/<chapter>/…/<id>`, `…/entries/npcs/<id>` and
  `…/entries/locations/<id>` are a 404.
- **A new location or a new chapter changes no field of the route.** The
  scene stays under `…/scenes/<id>`; if it changes chapter, it stands at the
  end of the target chapter (path 10, `cold-start`).
- **The generator names a scene by its resource segment**: the review step
  and the list of what was written show `scenes/<id>`, and a written scene
  links to `/campaigns/:c/scenes/<id>`. The fixture reply sets
  `location: raeucherkammer` and proposes that location in the same run —
  exactly what path 6 checks.
- **The order is set, not derived.** The seed run appends every scene to the
  end of its chapter, in the order it reads `scenes/` — alphabetically by
  `id`; a spec whose assertion depends on the order picks its ids
  accordingly or states the order it means itself —
  `PUT …/chapters/<chapter>/scene-order` with `{ scenes, rev }`, where `rev`
  is the `sceneOrderRev` of the `ChapterNode`. That guard counts only the
  writes of this list: a reorder moves neither `scenes.rev` nor
  `chapters.rev` and is therefore a conflict for no open editor — and the
  other way round, a scene's `PATCH` does not move `scene_order_rev`. The
  rows are addressed through their up/down controls, which carry the title
  in their accessible name (`chapterOverview.scene.moveUp.aria` and
  `…moveDown.aria` in the catalog).

## Running locally

```bash
bun install
bunx playwright install chromium     # once
bun run e2e                          # from the repo root

# or directly in e2e/
cd e2e
npx playwright test                          # everything
npx playwright test generator                # only the generator path
npx playwright test -g "quick note"          # by test name
npx playwright test --headed --debug 04      # watch it
npx playwright show-report                   # report after a failure
```

The prerequisite is `bun` in the `PATH` (server and stub run on it); if it
lives elsewhere, `GRIMOIRE_BUN=/path/to/bun` helps.

Useful switches:

| Variable        | Effect                                                       |
| --------------- | ------------------------------------------------------------ |
| `E2E_VERBOSE=1` | pass through the output of the server and the stub LLM       |
| `E2E_KEEP=1`    | keep databases and campaign copies after the run             |

## Layout

```
playwright.config.ts     project (chromium only), globalSetup, report
support/global-setup.ts  builds the app, creates the pristine copy of
                         fixtures/beispiel, starts the stub
support/test.ts          the suite's `test`: own database + own server +
                         `baseURL` per test, plus the fixtures `api`, `db`
                         and `seed`
support/api.ts           `Api`: the access to a test's server, bound to a
                         campaign, without knowledge of entities
support/campaign.ts, chapter.ts, scene.ts, npc.ts, location.ts,
support/thread.ts, idea.ts, glossary-term.ts, knowledge-item.ts
                         the helpers per entity: read, check, write, paths —
                         typed with `@grimoire/shared/<entity>`
support/session.ts       the helpers of the sessions
support/ui.ts            UI text through its catalog key (`ui`, `uiIn`,
                         `uiExact`)
support/procs.ts         managed child processes (start, wait, stop)
fixtures/stub-llm.ts     standalone LLM stub (can also be started alone)
fixtures/replies.ts      the canonical model replies
fixtures/*.json          scenes that single specs seed in addition
tests/*.e2e.ts           one spec per critical path (mapping below)
```

**Isolation:** Every test gets its own database *and* its own server process
on its own port (range from 3200, separate per worker). Assertions thus see
exactly the rows this test wrote — including the generator job, which is a
row itself. `fixtures/` is only copied, never changed. Seed plus boot cost
~0.2 s.

**The two assertion helpers:**

- `api` — the access to this test's server (`support/api.ts`), bound to the
  example campaign: `api.get`/`api.send` for every endpoint and `api.fetch`
  for status codes. `api` knows nothing about entities; a spec that creates
  a campaign of its own builds its own with `apiFor(server.url, id)`.

  What the suite knows about an entity lives in the **entity's module**
  under `support/`, as functions that take `api` as their first argument.
  The **campaign**, a **chapter**, a **scene**, an **NPC** and a
  **location** are each their own resource
  ([decisions/resources](../docs/decisions/resources.md)) and answer with
  their type from `@grimoire/shared/<entity>` (all fields flat, `body`,
  `rev`): `getCampaign(api)`, `getChapter(api, id)`, `getScene(api, id)`,
  `getNpc(api, id)` and `getLocation(api, id)`, plus
  `chapterExists`/`sceneExists`/`npcExists`/`locationExists(api, id)`,
  `campaignPath(api)`/`chapterPath(api, id?)`/`scenePath(api, id?)`/
  `npcPath(api, id?)`/`locationPath(api, id?)` for raw calls and the write
  path `patchCampaign(api, …)`/`patchChapter(api, id, …)`/
  `patchScene(api, id, …)`/`patchNpc(api, id, …)`/
  `patchLocation(api, id, { rev?, force?, …fields })` — without `rev` it
  fetches a fresh token and plays the "second writer" with it — and
  `createNpc(api, { name, id?, body? })`, the `POST …/npcs`.

  Thread and idea have their own modules: `getThreads(api, chapter)`,
  `getThread(api, id)`, `createThread(api, { chapter, text })`,
  `patchThread(api, id, { rev?, …fields })` and `threadPath(api, id?)`
  (`support/thread.ts`), `getIdeas(api)` and `ideaPath(api, id?)`
  (`support/idea.ts`). The **sessions** have their own module:
  `getRunningSession(api)` and `runningSessionId(api)` (the running one from
  `GET …/sessions?running=true` — `undefined` when nothing runs; the filter
  answers an empty list for that), `getLastStartedSession(api)` (the first
  of the list), `getSession(api, id)`, `sessionExists(api, id)`,
  `listSessions(api)` and the paths `sessionPath(api, id?)`,
  `pausePath(api, session, id?)` and `logEntryPath(api, session, id?)` for
  raw calls (`support/session.ts`). Every claim about a session, an idea or
  a thread reads a **field** — `log`, `pauses`, `done`, a scene's
  `status` —, never a rendered text. A session id the app assigns is an
  opaque random string: no spec writes one down, it always comes from the
  server. `todaySessionId()` is the date-shaped id of a session a spec
  **seeds itself**.
- `db` — reads this test's `grimoire.db` through the server's driver
  (`server/src/db/driver.ts`, no second SQLite dependency). Only for claims
  the API cannot make — row counts, for instance (`tests/seed.e2e.ts`).

Every write action of the UI is still checked twice: in the interface and
through the API.

Spec files are called `*.e2e.ts` so that `bun test` at the repo root does
not collect them (Bun matches `*.test.ts` and `*.spec.ts`).

## Adjusting the stub fixtures

`fixtures/replies.ts` holds the model replies as **objects**, exactly as the
enforced schema describes them: a scene call answers with all fields of the
scene (`body` one of them, `trigger`/`location` without a value as `null`,
the three lists always present) beside `warnings`; an NPC call with all
fields of the NPC (`body` one of them, a missing field as `null`,
`quickstats` as a list of `{ key, value }` pairs with string values) beside
`warnings`; a location call with all fields of the location beside
`warnings`; the outline its own format with the new NPCs and the new
locations as two lists of their own (`npcs`, `locations`). A string that is
not an object travels unchanged — that is a reply a test wrote to be
unreadable on purpose. The stub serializes the object as JSON into the
message content.

Covered are: the scene draft with a proposed NPC and location, augmenting a
scene, an NPC and a location, the NPC run and one deliberately invalid
variant of each. They satisfy the current mechanical validation of
`server/src/generator.ts`.

The stub is an OpenAI-compatible endpoint and **ignores**
`response_format`. That is exactly the value of this path: the run has to
work where the schema is not really enforced as well — for that the
tolerant reader in the server (`parseJsonReply`) is the net.

No reply contains an address: the `id` is everything the model decides
about addressing. The content rules remain (scene: `status: draft`, only
known callouts, `location` is an id, references exist or are proposed in the
same run; an NPC *with* a status, a location *without*; NPC run: kebab `id`,
no `chapter`, quickstats as a `{ key, value }` list with string values; in
every text each `[[id]]` names something of the campaign or a proposal of
the same run).

When a validation rule changes, this file is the place that follows along.
The specs assert the titles and ids defined there.

Which reply comes is decided by the prompt alone — the stub keeps no state
and can serve several workers in parallel:

- a section "existing location" in the prompt → **augment run of a
  location**. The location stands there as a JSON block with all its
  fields — exactly the object the reply is forced into. The reply mirrors
  every field back and appends exactly one new `## If:` section to `body`.
- a section "existing NPC" in the prompt → **augment run of an NPC**. The NPC
  stands there as a JSON block in its reply form (all fields, a missing one
  as `null`, `quickstats` as pairs) — exactly the object the reply is forced
  into. For an EMPTY NPC (created and not filled) `role`/`voice`/`motivation`
  are filled, `name` and `status` proposed differently and a text written;
  for a filled one the reply mirrors every field back and appends exactly
  one new `## If:` section to `body`.
- a section "existing scene" in the prompt → **augment run of a scene**. The
  scene stands there as a JSON block in its reply form (all fields, a
  missing one as `null`) — exactly the object the reply is forced into; the
  stub reads it with `JSON.parse` and not from a text. The reply mirrors
  every field back and appends exactly one new `## If:` section to `body` —
  every existing block unchanged. These branches are checked before the
  create runs: a scene augment run carries a `chapter:` line as well.
- the system prompt is the **outline prompt** → the outline call of a scene
  run. The reply is the scene list together with the lists `npcs` and
  `locations`; every scene quotes the first and last sentence of the source
  text **verbatim**, so that the server's excerpt cut really takes hold (a
  misassignment would be a warning in every spec).
- the prompt carries the run's **outline** and a `chapter:` line → a
  **scene part**; which scene is said by the marker on that scene in the
  outline block
- the prompt carries the outline but no `chapter` → an **NPC or location
  part** (depending on the system prompt), each in its own reply form
- no `chapter` and no outline → NPC run (one call); the given-id line fixes
  the NPC's id
- `E2E_SLOW` in the source text → the stub **never** answers (the connection
  dies with the server process that asked). That is the only way to look at
  a job while it really is `running` — the restart case of the job row.
- `E2E_INVALID` in the source text → a reply that breaks the validation
  (also in the correction turn, so the run ends in a 422)
- `E2E_TRUNCATED` in the source text → `finish_reason: "length"`
- `E2E_UNKNOWN_REF` in the source text → the **first** reply of an NPC or
  augment run names `[[der-fremde]]`, an id that does not exist; the
  correction turn (the call with the previous reply as the assistant turn)
  gets the good reply. So the run costs exactly one correction round and
  ends without that reference.
- `E2E_THREE_SCENES` in the source text → the outline has **three** scenes
  and no proposals — the shape in which parts can be seen finishing,
  failing and being retried one by one
- `E2E_PART_FAIL:<nonce>` → the **middle** of the three scenes breaks its
  whole first round (first call **and** correction turn) and succeeds from
  the second on. Only that makes the part really `failed` — an error the
  correction turn heals is no failed part —, and exactly that is what the
  retry action then repairs. The round counter is the stub's **only** state
  and hangs on the `nonce` the spec writes: that way parallel workers cannot
  take the failure away from each other.
- `E2E_ASCII_QUOTES` → the scene body carries German quotation marks with
  the **ASCII character `"`** as the closing mark. A reply the model had to
  wrap itself paid for that `"` with a correction round; as the `body` of an
  enforced object it is text, so the run has to reach `done` without a
  single correction round (two calls: outline + one scene).
- `E2E_DESCRIBE_ANYWAY` → the outline describes the chapter even when the
  run goes into an **existing** one — a model that ignores the prompt's
  rule. Otherwise the outline carries a description only when the context
  has the new-chapter line.
- `E2E_HOLD_LAST` → only the **last** scene is held, the others answer
  normally. That is the situation a restart in the middle of a run needs:
  finished parts to keep and one in flight. (The name deliberately does not
  begin with `E2E_SLOW` — that is checked as a substring and would hold
  every call.)

The stub also runs alone, e.g. to look at a prompt by hand:

```bash
bun e2e/fixtures/stub-llm.ts --port 4319
LLM_PROVIDER=openai LLM_BASE_URL=http://127.0.0.1:4319/v1 LLM_MODEL=stub \
  APP_DIST=app/dist GRIMOIRE_DATA=/tmp/grimoire-scratch \
  bun server/src/server.ts
# (with content: first GRIMOIRE_DATA=/tmp/grimoire-scratch \
#   bun server/src/cli.ts seed fixtures)
```

## Rule

**Whoever touches a critical path or creates a new one extends this suite in
the same PR — otherwise no merge** (`CLAUDE.md`, "Critical paths"). Paths
and specs correspond to each other; the number also stands in the header
line of the respective spec (the spec names deliberately do not carry it —
the suite has no order). A path can have more than one spec when several
write paths lie on it:

| Path (CLAUDE.md)   | Spec                                                           |
| ------------------ | -------------------------------------------------------------- |
| 1 Auto entry       | `tests/chapter-overview.e2e.ts` (one list, location in the meta line, order including 409, the chapter's status control) |
| 2 Read a scene     | `tests/scene-rendering.e2e.ts`                                 |
| 3 ⌘K search        | `tests/search.e2e.ts`                                          |
| 4 Session cycle    | `tests/session-cycle.e2e.ts`                                   |
| 5 Debrief          | `tests/review.e2e.ts`, `tests/threads.e2e.ts`                  |
| 6 Generator        | `tests/generator.e2e.ts`, `tests/generator-pipeline.e2e.ts`, `tests/generator-restart.e2e.ts`, `tests/augment.e2e.ts`, `tests/campaign-knowledge.e2e.ts` |
| 7 Properties/409   | `tests/status-control.e2e.ts`, `tests/properties-form.e2e.ts`, `tests/chapter-overview.e2e.ts` (the active chapter) |
| 8 Mobile           | `tests/mobile.e2e.ts`                                          |
| 9 Edit an entry    | `tests/block-composer.e2e.ts`, `tests/entry-edit.e2e.ts`, `tests/chapter-overview.e2e.ts` (the edit-campaign dialog) |
| 10 Cold start      | `tests/cold-start.e2e.ts`                                      |

Paths 3, 4, 5 and 8 read rows instead of texts:

- **Path 3** (`search.e2e.ts`): indexed are campaign, chapters, scenes, NPCs,
  locations and the glossary terms. Every hit carries `kind` + `id` and
  **no** `path` — the spec checks that on the wire and then clicks it in the
  palette: the campaign hit opens `/campaigns/beispiel`, the others
  `/campaigns/beispiel/chapters/<id>`, `/campaigns/beispiel/scenes/<id>`,
  `/campaigns/beispiel/npcs/<id>`, `/campaigns/beispiel/locations/<id>` or —
  a glossary hit with `kind: "glossary-term"` and the term's `id` —
  `/campaigns/beispiel/glossary`. Sessions and ideas are not indexed; a test
  of its own asks for words that occur only there and expects no hit.
- **Path 4** (`session-cycle.e2e.ts`): the quick note becomes a log **row**
  with `id`, `at`, `sceneId`, the text as the DM typed it, and its `rev` —
  and changes no scene `status`. The played checkbox beside the next-scene
  action is checked after a note in the open scene; so the click sets the
  `status` of the scene **being left** to `played` (checked through the
  API, and the scene stands in the navigation's played group and as played
  in the chapter overview). Unchecked by the DM, the click writes nothing;
  without a note but checked, it sets `played`. If a second writer changes
  the scene in the same `page.evaluate` as the click, the step shows the
  sentence for it and does not open the next scene; the second click
  succeeds. Ending changes no status. A **pause is an interval** in `pauses`
  and writes no log row — the proof is the unchanged length of the log plus
  the chip state `paused`. A test of its own checks the resources
  themselves: `?running=true` as a list of one or none, the list newest
  first, the session flat with embedded children whose writes do not move
  its `rev`, 409 on a stale `rev` of a pause and of the session, 409
  `session_ended` for every new child of an ended session,
  `session_not_empty` on discarding, and 404 on `…/session`,
  `…/session/start`, `…/log` and `…/sessions/<id>/played-scenes`. A note
  into a session ended elsewhere shows the sentence for it and leaves the
  text in the field; the foreign write and the Enter run in the same
  `page.evaluate` so that the poll does not come in between. Plus the
  reading page of a past session (`/campaigns/beispiel/sessions/2026-01-15`):
  log rows with scene links to `/campaigns/beispiel/scenes/<id>`, the closed
  pause with its duration, the scenes with notes (each once, in the order of
  their first note) — and the old entry address of the same session as a
  404. A scene's reading view offers the session start like every reading
  view.
- **Path 5** (`review.e2e.ts`, `threads.e2e.ts`): the review goes through a
  log row with `PATCH …/sessions/<id>/log/<log-id> { rev, reviewed }` and
  ticks off an idea with `PATCH …/ideas/<id> { rev, done }`, so the spec
  reads the `reviewed` of the log row it hit and the ticked-off idea with
  its new `rev` — and checks that no other one carries the flag. An idea
  with a stale `rev` is 409 with the current idea, a `text` in the `PATCH` a
  400, and `…/inbox` as well as `review/inbox-done` answer 404. Adopting a
  plot thread becomes a thread of the chapter (`POST …/threads`, flat with
  `chapter`); text and `rev` of the chapter stay the same, and so does the
  thread already there. Ticking off goes by `id` against the thread's `rev`
  (unknown: 404, stale state: 409 with the current thread).
  `threads.e2e.ts` maintains the threads in the chapter overview (path 1) —
  create, tick off, reword, delete, the conflict line with its reload
  action —, shows that a thread write does not drive an open chapter editor
  into a conflict, and checks the resource itself: flat answer, 400 for an
  unknown field, 409 with a stale `rev` (on `DELETE` as well) and 404 on
  `…/chapters/<chapter>/threads`.
  Creating an NPC from a `#npc` row is `POST …/npcs { name, id, body }`: a
  new NPC gets the note as its text, an empty one under the identifier is
  filled, and for an NPC with content the dialog stays open with the
  conflict sentence — nothing written, the log row stays
  `reviewed: false`. The log row as a resource: unknown id 404, stale `rev`
  409 with the current row under `logEntry`, `text` in the `PATCH` 400,
  `review/seen` 404, and the session's `rev` stays put. A log row changed
  elsewhere shows the sentence for it on its card, writes nothing, and the
  next click succeeds — foreign write and click in the same
  `page.evaluate`.
- **Path 8** (`mobile.e2e.ts`): the idea drop becomes an idea at the end;
  the spec compares all ideas including `rev`, which puts "the existing idea
  stays untouched" and "nothing ticked off" into one assertion.

`tests/campaign-knowledge.e2e.ts` is the half of path 6 in which the DM
maintains campaign knowledge and glossary on their pages: every glossary term
and every piece of campaign knowledge is its own resource with its own
`rev`. On the wire the spec checks the flat answer, 409 with the current
state, 400 for a foreign field and 404 on the old addresses `…/glossary` and
`…/knowledge`, plus the glossary intro as a field of the campaign. On the
pages: create, edit, delete, the duplicate term (409 with a sentence),
reordering the campaign knowledge through the order's own guard — no row's
`rev` moves — and two second writers: one changes the open row (conflict
line with the reload action and the save-anyway action, which writes only
the changed field), one the order (conflict line, the reload action fetches
it). A second writer on ANOTHER row is no conflict: the open term is saved
where it was typed. After that the run: the knowledge stands in the context
sent along (the stub echoes the prompt block), the name hints appear, the
accept action still works.

`tests/generator-restart.e2e.ts` is the restart half of path 6 and therefore
needs, like the seed spec below, two servers one after the other on the SAME
data directory: the first starts a run or brings it to its end, the second
is the restart. A **finished** job is then completely there (result,
`sceneEdits` per scene and field) and is accepted with the edited title and
text; a **running** one stands as `failed` with the sentence that the server
was restarted during the run and the job needs a new start, instead of as an
endless spinner, and the former addresses `GET …/generate/job` and
`POST …/generate/apply` answer 404.

`tests/generator-pipeline.e2e.ts` is the **pipeline half** of path 6: a run
with three scenes, one of which fails — the other two are reviewable and
acceptable one by one, while the broken part carries its error text and its
own retry action; afterwards all three are there and the accept-the-rest
action clears the run. Plus discarding in the middle of the run and a
restart in the middle of the run (two servers one after the other, as
above): finished parts remain, the part in flight becomes `failed` and can
be started again on the new process, because the outline comes back with
the row. The outline itself appears in no assertion — it is never shown to
the user.

`tests/generator.e2e.ts` additionally covers the **review state**: edit a
proposed scene → leave the page → come back → both are there (a field and a
line of text, read back on the job as `sceneEdits[<id>]`), and accepting
writes the edited title AND the edited text. Two tests beside it pin down
the separation: a change to the fields only leaves the run's text standing
byte for byte, a change to the text only leaves every other field of the run
standing. Each of them needs its own run — both write the same scene at the
end, and a second accept onto an existing id is a 409.

Whoever wants the textarea there goes through the switch: the edit action
opens the two areas properties (`role="region"`) and text, and the text area
starts on the blocks — only the Markdown option in the edit-mode group
brings the textarea, whose name is the Markdown-text label with the path
`scenes/<id>`. Saving happens implicitly (debounced, flushed on blur); what
can be observed is the quiet status line.

Further in the review state: decide a proposed entry → reload → the decision
stands; accept a scene on its own (the accept-this action) → the rest stays
reviewable and the progress line says one of three accepted → the
accept-the-rest action writes the rest and the job is gone. A second spec
shows the lead decision on it: the discard-the-rest action takes only the
open rest along, what was accepted on its own stays as an entry.
`tests/augment.e2e.ts` checks the same persistence at block level — a block
decision survives the reload.

`tests/augment.e2e.ts` is the augment half of path 6 (augment with AI): the
same run on a scene, an NPC or a location that already exists — each on its
own resource (job kind `scene-augment`, `npc-augment` or `location-augment`,
the proposal as the entity as read beside it as proposed, flat). The spec
shows: an empty NPC → augment → holes filled, while `name` and `status`
(both filled) are NOT replaced by default; a prepared scene → a new plot
thread as an additional block, every existing block equal character for
character, `status: ready` stays; discarding the proposal writes nothing and
takes the job along; and the 409 path (a second writer while the review
stands open) writes nothing and recovers on the next attempt. It
additionally touches path 2 (the reading view shows the result at once) and
path 8 — the action is desktop-only, the reading views of both kinds must
keep rendering at 390px.

Plus one spec that lies on none of the ten paths but on the seam beneath
them: `tests/seed.e2e.ts`, on the seed tool. It shows two things — that a
fresh instance starts **empty** (the boot loads nothing) and that
`grimoire seed` reads the fixtures completely (tree, scene bodies, NPC,
session, ideas, glossary terms, `seeded: beispiel` on stdout — each read
through its own endpoint), while a **second** run refuses because the
database already holds campaigns: same row counts, same content. It needs
boots of its own and therefore uses `startGrimoireServer`/`seedCampaigns`
directly instead of the `server` fixture.

On path 7 two specs share the work: `status-control.e2e.ts` covers the
status control (one key, conflict over the poll window; the control has no
conflict actions and only reports the stale state), `properties-form.e2e.ts`
the properties dialog (all fields of an entity kind,
chips/references/select, emptying deletes the key, and the deterministic
409: the dialog writes against the version its editing began with, and
answers the conflict with its two actions — the reload action shows the
current values, the save-anyway action writes only the dialog's fields, so a
concurrent text change survives it and is read back through the API). The
dialog additionally touches path 2 (the reading view shows the new values at
once) and path 8 (form at 390px) — both stand in the same spec.
`properties-form.e2e.ts` also checks the new location there: changing
`location` is a field of the scene, the route stays `…/scenes/<id>`, the
chapter overview keeps the order and names the new location's name, and the
session's log rows stay valid (their `sceneId` names the scene by its id).
Free text in `location` is a 400 there with `code: "location_not_an_id"` —
the counter-check stands in `scene-rendering.e2e.ts`. And because status and
type are `CHECK` constraints of their columns
([decisions/constraints](../docs/decisions/constraints.md)), a test in the
same spec pins the rule down directly at the write path: a `status` outside
the closed list is a 400 with `code: "status_not_allowed"` together with
`kind`, `value` and `allowed`, and the scene stays unchanged — the row
version too. A stale `rev` on a scene's `PATCH` is 409 with the scene, a
field it does not have a 400 that names it — `POST` as well as `PATCH`
(`scene-rendering.e2e.ts`).

On path 9 two specs share the two surfaces of editing, which share ONE
draft: `block-composer.e2e.ts` covers the block composer — default mode, one
card per block, create/move, children of an `## If:` section, unknown
constructs as a raw block, the save lock for a `##` in an if child (hint on
the card, save action off, entry unchanged), the 409 with an open block form
and the operation at 390px. `entry-edit.e2e.ts` covers the Markdown
fallback: the textarea, its preview (which exists only there), the kinds
with and without an editor and the loss paths (navigation, failed refetch).
Plus the two conflict answers in one test each — the same setup, a foreign
status write beside the open editor: the reload action discards the draft
and shows the stored text together with the changed status — on the same
surface, the answer to a conflict pushes nobody from the textarea into the
composer —, the save-anyway action writes the text and leaves the foreign
status standing. One test shows fields and text in ONE request directly at
the scene's write path — one step of the row version, and no field at all
is 400 `nothing_to_write` —, because no surface of the app sends both in
one save today. Chapter and campaign are their own resources
([decisions/resources](../docs/decisions/resources.md)): a test reads both
flat (all fields side by side, without `kind`, `path` and `properties`),
sends a stale `rev` (409 with the current state, nothing written) and a
field the entity does not have (400 that names it). There is no general
endpoint: every address that formerly formed `…/entries/*` — the chapter,
`campaign`, the lists, NPC, location and scene — answers 404, no redirect,
no alias. The spec pins exactly that down in ONE place (GET and PATCH). The
text of a chapter is edited on its reading view
`/campaigns/:id/chapters/<id>` like that of a scene — saved, rendered, title
and status unchanged — and a second writer leads to the conflict line, whose
reload action takes over the stored state. A glossary term is its own
resource that the glossary page shows, which the same spec shows. Every test
there enters the editor through `openMarkdownEditor` — first the edit
action, then the Markdown switch —, because the edit action alone lands in
the composer. One test there additionally covers the new location: a scene
whose `location` changed stays under its route and is edited and saved
there.

Path 10 (`cold-start.e2e.ts`) is the only path that runs WITHOUT a seed:
`test.use({ seed: { skip: true } })` starts the server on an empty data
directory, the seed tool never runs — exactly what a fresh installation is.
The spec therefore creates everything itself (campaign → chapter → scene →
text → session; the new scene opens in the editor under
`/campaigns/:id/scenes/<id>`, and a chapter change in the properties dialog
appends it to the end of the target chapter) and builds its `api` helper
with `apiFor(server.url, id)`, because the campaign id only exists at
runtime. Plus the two list entries (create NPC/location, the lists on
`/campaigns/:id/npcs` and `/campaigns/:id/locations`) with the slug
collision — 409 with a suggestion, nothing written, the suggestion as one
click; for the NPC also on the wire together with the 400 for an unknown
field —, the self-chosen identifier at the pencil of the preview line
([decisions/constraints](../docs/decisions/constraints.md): the create
dialog is the only place for it — an invalid identifier blocks the create
action, an empty field derives it from the name again) and the same lists
at 390px, which puts the spec on path 8 as well.

Both read the scene back through the API after every save, and the composer
parses and serializes the body: "not a byte of diff except the edited block"
is therefore the actual assertion, not a `toContain` on the new sentence.

UI text in locators and assertions comes from the catalog through
`support/ui.ts`, never spelled out in a spec (decisions/testing): when a text
of the app changes, the catalog changes and the spec stays as it is.

A spec also covers later slices on its path, not only the slice that created
it: `tests/chapter-overview.e2e.ts` additionally checks the location name in
the meta line, the scene order including its conflict (and that a scene's
`PATCH` does not move its guard), the row that opens on
`/campaigns/:id/scenes/<id>`, the topbar navigation and the edit-campaign
dialog (name, description and text through `PATCH /campaigns/:id`, including
the conflict line, whose save-anyway action writes only the changed fields),
`tests/review.e2e.ts` the scene title in the source chip, and
`tests/search.e2e.ts` the freshness assertion of the cutover: what the APP
has just written, ⌘K finds at once — the index moves along in the same
transaction, there is no watcher any more to wait for.

## The chapter as its own resource

Two paths carry the chapter as its own resource.

- **Path 6** (`generator.e2e.ts`): new chapter → **leave the page** → come
  back → accept. The navigation is the core of the test, not decoration:
  the review step is persistent, so exactly that is the normal case. Title
  and id of the new chapter lie on the job
  (`generate_jobs.new_chapter_title`, written at the **start**), and the
  spec checks them on the chapter (`getChapter(api, id)`) AND in the
  overview. The outline describes the new chapter (the stub answers with a
  description as soon as the context carries the new-chapter line): the
  review of the drafts shows it as the chapter's description, and the
  chapter has it as its text afterwards. A run into an existing chapter with
  `E2E_DESCRIBE_ANYWAY` shows that a description delivered anyway does not
  reach that chapter's text.
  Note: a bulk accept leaves **undecided** proposed entries open (rule of the
  review step), the review step stays and reports one of three accepted —
  the chapter is already written by the first accept.
- **Path 1** (`chapter-overview.e2e.ts`): a chapter is editable where it is
  read — the chapter properties action (title/status, the chapter's dialog),
  the edit-chapter action (the chapter text the overview shows, including
  the 409 against a second writer) and the **status control** in the chapter
  row. Every value is **one** `PATCH …/chapters/<id> { rev, status }`;
  active makes the chapter the active one, the server sets the previously
  active one to planned in the same operation, and according to the tree
  exactly one chapter is active. A second writer between opening the menu
  and the pick results in the quiet message without conflict actions
  (path 7), the next pick succeeds. The overview shows the text of chapter
  and campaign whole and rendered, limited to four lines: the show-more
  toggle stands there only for a longer text (the spec writes a long text
  through the API for that), opens and closes it, and a reference in the
  cut-off part opens it as soon as it gets the keyboard focus.

Two traps for new specs on these paths:

- **Names match as a substring.** The edit-chapter label contains the edit
  label, and in the chapter overview both stand on one page. Whoever means
  the action of the CAMPAIGN HEADER writes
  `getByRole("button", { name: uiExact("common.edit") })`.
- **Address the dialogs' fields by their role.** The properties dialog
  writes the required marker into the label, so the accessible name is the
  field label plus the required marker — `getByRole("textbox", { name: … })`
  is more robust there than `getByLabel`.
