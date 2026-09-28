# CLAUDE.md — Grimoire

Grimoire is a self-hosted single-user tool for a D&D game master: session
preparation and live running on top of a campaign database (SQLite,
decisions/sqlite; Markdown is the content format of the bodies).
It is NOT a VTT, NOT a campaign wiki, and has NO player view.

## Required reading before every task

1. `README.md` — data model and conventions: the entities, their fields and
   addresses, the text vocabulary (callouts, `If:` sections, hashtags) and
   the writing rules. All of it is normative.
2. `docs/decisions/` — architecture decisions including the tech stack, one
   file per topic (overview in `docs/decisions/README.md`). Decisions there
   are binding; deviations only by rewriting the file or creating a new one.
   A decision records only target decisions: no temporary decisions, no
   intermediate states. The intermediate state of a rework cut into slices
   lives only in the ticket.
   A decision records only real decisions with lasting validity (principle,
   why, consequences) — never inventories (tables, columns, endpoints, error
   codes, file or function names), implementation detail, or anything from
   older versions. It must stay true when the code grows.
3. `docs/UI-BRIEF.md` — design direction for everything visible

## Stack (short version, details in docs/decisions/stack.md)

- Frontend: Vite + React 19 + Tailwind v4 + shadcn/ui, TanStack Query,
  react-markdown + a custom remark plugin for callouts and `## If:`
- Backend: Bun + Hono, SQLite via Drizzle (`server/src/db/`), search as an
  FTS5 index
- Storage: **one SQLite file is the source of truth** (decisions/sqlite),
  `GRIMOIRE_DATA/grimoire.db`
- Rule: no Bun-only APIs without an entry in decisions/stack (Node
  portability). Exactly one is registered: `bun:sqlite` as a fallback behind
  `server/src/db/driver.ts`

## Project structure

- `fixtures/` — the example campaign as JSON, one campaign directory with
  one object per file in the shape of the API: the campaign under
  `fixtures/campaigns/<id>.json`, a chapter under
  `fixtures/chapters/<id>.json`, a scene under `fixtures/scenes/<id>.json`,
  an NPC under `fixtures/npcs/<id>.json`, a location under
  `fixtures/locations/<id>.json`, a thread under
  `fixtures/threads/<id>.json`, an idea under `fixtures/ideas/<id>.json`, a
  glossary term under `fixtures/glossary-terms/<id>.json`, campaign
  knowledge under `fixtures/knowledge-items/<id>.json`, a session with its
  pauses and log lines under `fixtures/sessions/<id>.json`, each as the
  object its resource returns, without `rev`. It is
  the **seed** for dev/tests/E2E and the reference for callouts. NEVER
  reformat or "tidy up" bodies; the format is a contract.
- `GRIMOIRE_DATA` (default `./data`, gitignored) — this is where
  `grimoire.db` with its `-wal`/`-shm` lives: the actual data. No code reads
  campaign content from anywhere else.
- `shared/` — entity types (`@grimoire/shared`), shared by server and app.
  The authority over the format is `server/src/db/schema.ts` (storage
  shape), described in README.md — keep both in sync. An entity with its own
  resource has its zod schema in `shared/src/<entity>.ts`
  (decisions/resources).
- `server/` — Hono API. The endpoints are documented where they live: one
  route module per resource, `server/src/routes/<resource>.ts`, one comment
  per route — no checklist. `server/src/routes/api.ts` assembles the modules
  and describes what applies to all routes (error body including `code`);
  shared HTTP helpers live in `server/src/routes/http.ts`.
  `server/src/server.ts` only assembles the app. Data access exclusively via
  `server/src/store/<domain>.ts` (queries), never SQL directly from a route.
  **The store is cut by domain:** one module per kind
  — `campaigns`, `chapters` (with the scene order), `scenes`, `npcs`,
  `locations`, `threads`, `ideas`, `sessions` (with `session-rows`, the
  session row its children look up), `pauses`, `log-entries`,
  `glossary-terms`,
  `knowledge-items` (with their order),
  `item-prices` (read only, decisions/reference-data),
  `item-price-imports` (the DM's own item lists, the only writer of the
  items they bring),
  `random-table-sources` (the import of a 5etools file and the removal of a
  source) and `random-tables` (their tables, written only by that import),
  `generated` (accepting a generator run),
  `trash` (the purge of rows past the trash's retention, decisions/trash) — and
  each carries the **read AND write access** of its kind. No catch-all
  module and no barrel: every caller imports from the domain it needs.
- `app/` — the frontend. Every entity with its own resource has its slice
  `app/src/<entity>/` (`campaign/`, `chapter/`, `scene/`, `npc/`,
  `location/`, `thread/`, `idea/`, `glossary-term/`, `knowledge-item/`,
  `item-price/`, `random-table/`, `session/`, `generator-job/`) with everything the app knows about it
  (decisions/resources); **slices do not import each other.** Pause and log
  line belong to the `session/` slice: the app reads them only embedded in
  their session, and every one of their writes lands in the session's cache;
  their resources each have their own module there (`pause-api.ts`,
  `log-entry-api.ts`). The same holds for the item-price import in the
  `item-price/` slice (`item-price-import-api.ts`): it is managed on the
  price page, and its writes land in the item prices. Shared are
  only UI building blocks without knowledge of entities
  (`app/src/components/`, e.g. `components/fields/`); mixed places (search,
  `[[id]]` resolution, campaign tree) are pure dispatchers. A page that
  shows several entities is composed from the slices like `App.tsx` and
  passes foreign parts in as a slot (the chapter overview passes the chapter
  its threads and its scene list, the scene gets its NPC cards, the reading
  page of a session gets the link of a scene, the live view's next-scene
  step gets setting the scene status; scene, NPC and location get
  their augment action from the generator job; the random tables page gets
  what a rolled result becomes). Whatever connects two slices
  lives with the page that composes them (the reminders of the live view
  from log lines and ideas in `routes/PcReminders.tsx`, the augment actions
  in `routes/<Entity>AugmentAction.tsx`, a rolled result as a log line or an
  idea in `routes/random-tables.tsx`). No barrel:
  callers import the concrete file.
- `generator/` — LLM pipeline (prompt, few-shot, process README).
- `design/` — binding design reference (the PO's Claude Design export, see
  design/README.md). If it contradicts docs/UI-BRIEF.md, design/ wins.
- `docs/` — the longer documents: `decisions/` (binding decisions, one file
  per topic), `UI-BRIEF.md` (design intent), `DEPLOYMENT.md` (operations).
  `README.md` and `CLAUDE.md` stay in the root (tooling convention).

## Way of working

- Vertical slices, one per assignment. Not several views at once.
- Develop against real data: no invented mock objects. The database is the
  truth (decisions/sqlite), and the server starts **empty**: running
  `bun run --filter @grimoire/server seed` once (reads `fixtures/`) fills
  `GRIMOIRE_DATA/grimoire.db`. Tests get a fresh in-memory DB per case,
  seeded from the same fixtures (`server/test/support/store.ts`).
  `campaigns/` exists only locally on the user's machine and must never be
  assumed in code, tests or docs.
- The callout renderer (`[!readaloud]`, `[!check]`, `[!secret]`,
  `[!outcome]`, `[!loot]`, `[!note]`) is the central component — always
  check changes to it against the reference scenes
  `fixtures/scenes/lighthouse-arrival.json` and
  `fixtures/scenes/smuggler-captured.json`, visible in the dev harness
  `/dev/markdown`.
- The format degrades: render unknown callouts/headings as normal text,
  never throw.
- The app writes only through the documented API; patches carry the guard
  token of the read (`rev`, the row version) — 409 on conflict, never a
  silent overwrite.
- Campaign, chapter, scene, NPC, location, thread, idea, glossary term,
  campaign knowledge and session with pause and log line are each their
  own resource (decisions/resources):
  `/campaigns/<id>` responds with `Campaign`, `…/chapters/<id>` with
  `Chapter`, `…/scenes/<id>` with `Scene`, `…/npcs/<id>` with `Npc`,
  `…/locations/<id>` with `Location`, `…/threads/<id>` with `Thread`,
  `…/ideas/<id>` with `Idea`, `…/glossary-terms/<id>` with `GlossaryTerm`,
  `/api/item-prices/<id>` with `ItemPrice` (reference data of the instance,
  decisions/reference-data, read only),
  `/api/item-price-imports/<id>` with `ItemPriceImport` (the DM's own item
  list, written whole with `PUT`, removed with `DELETE { rev }`),
  `/api/random-table-sources/<id>` with `RandomTableSource` and
  `/api/random-tables/<id>` with `RandomTable` (reference data the DM
  imports from a 5etools file, decisions/reference-data; the import is their
  only writer, and a source is removed as a whole),
  `…/knowledge-items/<id>` with `KnowledgeItem`, `…/sessions/<id>` with
  `Session` (pauses and log lines embedded), all fields side
  by side,
  `body` included where the entity has one, without `kind` and `path`;
  every row carries its own `rev`. The app routes are
  `/campaigns/:id` (chapter overview), `/campaigns/:id/chapters/<id>`,
  `/campaigns/:id/scenes/<id>`, `/campaigns/:id/npcs/<id>` and
  `/campaigns/:id/locations/<id>`; threads are maintained by the chapter
  overview, ideas by the debrief and the mobile start surface, glossary terms
  by the page `/campaigns/:id/glossary` and campaign knowledge by
  `/campaigns/:id/knowledge`; random tables are imported and rolled on
  `/campaigns/:id/random-tables`; what is in the trash is listed and restored
  on `/campaigns/:id/trash` (decisions/trash).
  A scene and a thread lie flat under their campaign; their chapter is a
  field. Which
  chapter is active is said by its `status`: at most one per campaign, and
  whoever activates one sets the previously active one to `planned` in the
  same operation.
- The children of a session hang under it and are written only there:
  `POST …/sessions/<id>/pauses` begins a pause, `PATCH
  …/pauses/<pause-id> { rev, toMs }` ends it; `POST …/sessions/<id>/log`
  creates a log line, `PATCH …/log/<log-id> { rev, reviewed }` reviews
  it. A scene is played solely through its `status` (`played`); a session
  holds no played scenes.
  The running session is returned by `GET …/sessions?running=true` (one or
  none); the list is newest first. `POST …/sessions` starts,
  `PATCH …/sessions/<id> { rev, endedMs }` ends, `DELETE` discards an empty
  one. The client writes a point in time as an epoch value (`…Ms`); the
  server derives the zoneless local time from it.
- The generator job is its own resource, at most one per campaign:
  `POST …/generator-jobs { kind, … }` starts a scene or NPC run
  (an augment run starts on its entity), `GET …/generator-jobs`
  returns it (one or none). `PATCH …/generator-jobs/<id> { rev, … }`
  reviews and accepts: accepting means naming proposals in
  `review.writtenScenes`/`writtenNpcs`/`writtenLocations`; once nothing is
  open any more, the job is done and the response is its final state.
  `PATCH …/parts/<key> { status: "running" }` retries a part,
  `{ rev, round }` there answers its notes and decides the changes,
  `DELETE { rev }` discards the job.
- UI language: German (primary language), English as the second language.
- Repository language (decisions/language): everything in the repo is
  English — code, identifiers, comments, test names, commits, docs,
  decisions, agent instructions, the example campaign in `fixtures/`.
  German exists only in the German UI catalog (`app/src/i18n/de.ts`). In
  code and docs, describe a UI label in English instead of quoting it.
- Comments explain the code and stand on their own: no references to issues,
  PRs or reviews. References to decisions (`decisions/sqlite`) are allowed —
  they point to a document in the repo, not to a ticket.
- Scout rule: whoever touches a file for another reason brings the whole
  file in line with the two rules above in the same change — German prose,
  comments and test names become English, issue references go — not only the
  changed lines. There is no separate cleanup PR.
- Migration files are not tested — what is tested is the behavior they
  enable (constraint errors on the write path), not their SQL.
- Data changes are part of the migration itself (SQL, same transaction):
  no preflight, no data step, no boot pass beside it.
  There is no transitional code: a rework is cut so that neither adapters
  nor double paths arise.
- One resource per entity (decisions/resources): every entity of the
  database has its own endpoint, its own type, its own zod module as the
  single source and its own app route; there is no general endpoint across
  several entities. Every field is a field of the entity, `body`
  included — no umbrella terms like "properties" versus "text", no "entry"
  or "draft" as a common shape. Where things are genuinely mixed (search),
  the hit names its entity explicitly (`kind`).
- Data are rows of their table in the database, not files and not
  documents — in prompts, schema names and descriptions, identifiers,
  comments, docs and catalog. Prompts say only what the model should do:
  no prohibitions, no "no longer" notes, no history.
- Fixes are limited to the cause: no additional safeguards, no tests and no
  operations docs beyond the assignment. Comments describe the state, never
  the history of a bug or the PO's setup.
- Dependencies over home-grown code (decisions/dependencies): for general
  tasks (validation, schemas, date and time, …) an established package is
  added, not built in-house. Only Bun-only APIs still require an entry in
  decisions/stack (Node portability).
- A schema has exactly one source; a derived shape is never rebuilt by
  hand. The schema of an entity is its zod schema, and type, patch, seed and
  generator shape are derived from it (decisions/resources).
  Fixtures remain the object itself (a response fixture as the object
  itself, an entity as the object its resource returns).
- User-visible texts NEVER directly in components, but in the catalog
  `app/src/i18n/` (`de.ts` = key set, `en.ts` must be complete, otherwise a
  type error). `t()` comes from `useT()`/`useI18n()`; pure helpers in
  `app/src/lib/` get the translator as an argument. Details: decisions/i18n.
  `bun run lint` is the gate; every rule is an error.
- UI texts are whole sentences the DM understands: if the behavior behind a
  text changes, the de/en sentence is reworded, never a fragment swapped
  out. No raw wire values (`status: unknown`) in the sentence, but the UI
  label. The lead checks the wording for logic before the PR goes to the
  PO.

## Backlog process

- The PO drops ideas in as issues with the label `idee` (template `Idee`) —
  informal, free text is enough.
- Refinement happens IN the issue: ask follow-up questions as comments;
  then expand the issue body into a ticket — user story ("As a DM I
  want … so that …"), acceptance criteria (verifiable), scope/non-goals,
  dependencies. Only after the PO's ok in the thread: label `idee` →
  `ready`. An ok from the PO in conversation with the lead counts the same;
  the lead records it in the thread before setting `ready`.
- The team only takes `ready` tickets. Taking one = label `in Arbeit` +
  a comment with the cut; done = closing with a commit reference.
- At the start of every work session: review open `idee` issues before
  new work starts.
- Before merging a slice with a UI part, the lead runs the real click path
  personally (server + built app, production topology) — agent smoke
  reports do not replace that.

## Branch & PR process (main is production)

- NO direct pushes to main. (Server-side branch protection is not
  available on the free plan for private repos — the rule is binding by
  process; on switching to Pro/public it will be enforced technically.)
- Every ticket: its own worktree + feature branch (`<nr>-<slug>`), result
  as a PR. Merge prerequisites: CI green (tests, typecheck, build, E2E),
  the lead's click path, AND PO approval on the PR.
- The lead does not implement, not even small things. Implementation is
  done by engineer agents on Opus (`model: "opus"`, own worktree); Fable
  only for the lead and, at the PO's explicit request, for a designer.
- The lead's click path runs on the FINAL PR state after the last commit,
  also after review-fix rounds. No PR goes to the PO untested.
- main is deployable by definition but publishes nothing: images are created
  only on release (decisions/release). The PO pulls a version tag
  deliberately; rollback = an older version tag.

## Commit & release conventions (decisions/release)

- **Conventional Commits are mandatory**, they generate the changelog:
  `feat: …` (minor), `fix: …` (patch), `docs:`/`chore:`/`refactor:`/`test:`/
  `ci:` (no release bump). Breaking change = `feat!: …` or a
  `BREAKING CHANGE:` footer in the body. Scope optional but customary:
  `feat(app): …`, `fix(server): …`. The ticket number goes in the subject
  suffix: `feat(app): scene editor (#43)`.
- This also applies to the **PR title**: squash merges take it as the commit
  subject on `main`; an unconventional title drops out of the changelog.
- **release-please** keeps a release PR from these commits
  ("chore(main): release X.Y.Z"). Only its merge — with PO approval like
  every PR — creates the tag `vX.Y.Z`, the GitHub release, `CHANGELOG.md` and
  the GHCR image with the version tag and `:latest`. Nothing is ever tagged
  by hand, and `CHANGELOG.md`/`.release-please-manifest.json` are never
  edited by hand.
- **`:latest` means "last release", not "last merge".** The release
  workflow is the only writer to the GHCR registry; `ci.yml` builds the
  image to check it (`push: false`) but never pushes it.

## Critical paths (E2E required, real suite without mocks)

Playwright against the real stack (real server on its own DB seeded from
`fixtures/`, built app, real browser; the only exception: the LLM is a local
stub HTTP server — the provider path runs for real).
The paths:

1. Auto entry `/` → the chapter loads the campaign: one continuous scene
   list in the DM's order (no location groups, the location is in the meta
   line), reordered via up/down — the write path carries the order's own
   guard (`scene_order_rev`), a stale state is 409, and neither scene nor
   chapter `rev` moves. Below the chapter text are the chapter's threads
   (`GET …/threads?chapter=<id>`, in order of creation) and they are
   maintained there: create, tick off, reword, delete — each thread with its
   own `rev` (`PATCH`/`DELETE …/threads/<id>`, a stale state is 409 with the
   current thread); chapter text and chapter `rev` stay untouched. The
   campaign menu in the topbar is the one entry point into every area
   (chapters, scenes, NPCs, locations, glossary, campaign knowledge,
   item prices, random tables, debrief, trash): closed it names the campaign and the
   current area, opened it marks that area and works with the keyboard; no
   other link leads into an area
2. Read a scene: opened from that list (`/campaigns/:id/scenes/<id>`, read
   via `GET …/scenes/<id>`) — callouts, if sections, NPC cards of the
   reference scenes
3. ⌘K search finds and opens: indexed are campaign, chapters, scenes,
   NPCs, locations, the glossary terms, the instance's item prices and
   the random tables the DM imported.
   Every hit names itself with `kind` + `id` without an address: a campaign hit opens
   `/campaigns/:id`, a chapter hit `/campaigns/:id/chapters/<id>`, a
   scene hit `/campaigns/:id/scenes/<id>`, an
   NPC hit `/campaigns/:id/npcs/<id>`, a location hit
   `/campaigns/:id/locations/<id>`, a glossary hit
   (`kind: "glossary-term"`, the term's `id`) `/campaigns/:id/glossary`
   an item hit (`kind: "item-price"`) `/campaigns/:id/item-prices?item=<id>`
   with that item marked and its price shown, and a random-table hit
   (`kind: "random-table"`) `/campaigns/:id/random-tables?table=<id>` with
   that table open;
   sessions and ideas are not indexed; typing an area's name offers that
   area, from the same list the campaign menu reads
4. Session cycle: start (open is the first scene of the order that is
   neither `played` nor `dropped`, otherwise the first; the running session
   is returned by `GET …/sessions?running=true`) → quick note → log **line**
   with `sceneId` (`POST …/sessions/<id>/log`); the note changes **no**
   scene `status` → the next-scene action leads to the following one in the
   order; next to it sits the played checkbox, checked when the session has
   a log line with the `sceneId` of the open scene, and changeable by the
   DM. When checked, the click sets **the scene being left** to played
   (`PATCH …/scenes/<id> { rev, status: "played" }`, nothing if it already
   is; afterwards it stands in the played group and as played in the
   chapter overview); unchecked, it writes nothing. If the scene was changed
   elsewhere (409), the next scene does not open, the step says so in a
   whole sentence, and the second click writes against the reloaded `rev`
   → pause (`POST …/pauses`, an interval, no log line; ended with `PATCH
   …/pauses/<id> { rev, toMs }`) → end (`PATCH …/sessions/<id> { rev,
   endedMs }`; this changes no scene `status`) → debrief. Every child carries its own `rev`; none
   moves the session's; on an ended session every new child is 409
   `session_ended`, and the live view says so in a whole sentence. The old
   addresses `…/session`, `…/session/start`, `…/log` and
   `…/sessions/<id>/played-scenes` respond 404. Plus the reading page of a
   past session (`/campaigns/:id/sessions/<session-id>`) with the scenes of
   its log lines, each once, as links
5. Debrief (reached from the campaign menu, whose debrief entry names the
   open count): accept a plot thread → a thread of the active chapter
   (`POST …/threads { chapter, text }`, without `rev`; chapter text and
   chapter `rev` stay untouched); tick off an idea → `PATCH …/ideas/<id>
   { rev, done }`, a stale `rev` is 409 with the current idea. The debrief
   takes the first session of the list (the most recently started, also
   across midnight) and reviews a log line with `PATCH
   …/sessions/<id>/log/<log-id> { rev, reviewed }` — an unknown id is
   404, a stale `rev` 409 with the current line, and the card says that the
   note was changed elsewhere; `review/seen` responds 404
6. Generator cycle (stub LLM): job → review proposals → accept →
   scene in the chapters; plus the 409/error path. The review of a scene
   run walks in stages (decisions/generator): the new locations, then the
   new NPCs, then the scenes; a stage without proposals is skipped, and the
   stage is stored on the job (`review.stage`). Each location and NPC is
   accepted (written right away) or rejected on its own; the scene stage
   opens only when both are decided, and going back stays possible.
   A part's model notes stand on its card and its naming hints at the field
   or block they name, until the part is written, rejected or dropped; the
   run's own notes stand above the stages until the job is done. Accepting
   a scene writes only that scene: one whose `npcs` or `location` names an
   unwritten proposal of the run is 409 `proposal_not_written` and
   writes nothing (a `[[id]]` in the text never blocks), and its card says
   so in a whole sentence and offers to accept the proposal after all,
   remove the reference, or drop the scene. Answering a part's notes
   (`PATCH …/parts/<key> { rev, round: { answers } }`) patches its proposal:
   the stub's patch has a block replace, a field set and an anchor that
   hits nothing, the comparison shows exactly the two applied changes plus
   the finding carrying that anchor (`part-finding`), and taking them (`round: { changes }`)
   writes them into `sceneEdits` or `locationEdits` and the answered note is
   gone; an answer sent with its knowledge box ticked (`asKnowledge`) is a
   `fact` knowledge item, the stub's echo shows it in that round's context,
   and it stands on `/campaigns/:id/knowledge`. A proposed scene is
   the scene without `rev` (`result.scenes`, decisions/resources): the edit
   action opens its fields and its text, the changed fields are saved per
   scene (`sceneEdits`), and the accept action writes them over the model's
   proposal; reviewing, discarding and accepting happen per `id`, all via
   `PATCH …/generator-jobs/<id>` (a stale `rev` is 409 with the current
   job), and the old addresses `…/generate/apply` and `…/generate/job`
   respond 404. Plus
   maintaining campaign knowledge and glossary on their own pages
   (`/campaigns/:id/knowledge`, `/campaigns/:id/glossary`) — create,
   edit, delete, each row with its own `rev`
   (`…/knowledge-items/<id>`, `…/glossary-terms/<id>`, a stale state is 409
   with the current row), reordering the campaign knowledge via its own
   guard (`PUT …/knowledge-item-order`, a stale state is 409 with the
   current order, no row's `rev` moves); the old list addresses
   `…/glossary` and `…/knowledge` respond 404 — and the run after that:
   knowledge in the context sent along (the stub echoes the prompt block
   back), name hints at their place while reviewing the proposals,
   accepting still possible, and a server restart (a finished job survives
   it and stays acceptable, a running one is reported as `failed`). The
   scenes of a run stand in the chapter in outline order, even when they
   are accepted one by one and in reverse order — start value at the first acceptance plus the number in
   the outline (decisions/scene-order)
7. Edit modes of scene, NPC, location and chapter / status control
   including the 409 conflict. No entity has a fields dialog: every field is
   edited in the edit mode of its reading view. The scene's edit mode on
   `/campaigns/:id/scenes/<id>` edits title, trigger (contingency scenes
   only), status, the field chips (type, location, NPCs, tags, handouts,
   chapter) and `body` together; the NPC's edit mode on
   `/campaigns/:id/npcs/<id>` edits name, status, the field chips (quick
   stats, statblock, chapter), the collapsible profile (role, voice,
   appearance, motivation — one line while collapsed) and `body` together;
   the location's edit mode on `/campaigns/:id/locations/<id>` edits name,
   the field chips (chapter, Roll20 page), the collapsible atmosphere and
   `body` together; the chapter's edit mode on
   `/campaigns/:id/chapters/<id>` — opened by its edit action there or in
   the chapter overview — edits title, status and `body` together. A chip
   opens only its field — a popover on desktop, a bottom sheet on a phone;
   at 390px the chips wrap, the first three stand and a sheet lists the
   rest, the save actions sit at the bottom, no horizontal scroll. Saving is
   ONE `PATCH …/scenes/<id>`, `PATCH …/npcs/<id>`, `PATCH
   …/locations/<id>` or `PATCH …/chapters/<id>` carrying only the changed
   fields plus `rev`. A 409 shows the same conflict line above the title or
   name: the reload action takes the stored row, the save-anyway action
   writes only the changed fields. Leaving with unsaved
   changes asks first. The status control of a reading view has no conflict
   actions: it reports the stale state, and the DM reloads.
   The control and the chapter's edit mode activate a chapter with `PATCH
   …/chapters/<id> { rev, status: "active" }`; the previously active one is
   then `planned`, and exactly one chapter is active.
8. Mobile start surface + idea drop at 390px: search and idea drop above
   the chapter overview; the campaign menu opens as a bottom sheet with
   every area; the idea becomes an idea
   (`POST …/ideas`, responds with `Idea`), at the end, nothing ticked off;
   if a session is running (`GET …/sessions?running=true`), the start
   surface shows its chip as the way back
9. Edit the text of a scene: open its edit mode → change `body` → save →
   visible rendered; 409 on a competing second write → the same
   conflict line instead of silently overwriting. The reload action
   discards the unsaved edits and takes over the saved state, the
   save-anyway action writes only the fields changed in the edit mode, so
   that a field changed by someone else stays.
   Because all fields of a scene,
   `body` included, share ONE row and ONE guard (decisions/writes), a pure
   status write by a second writer is a conflict too — nothing next to the
   open edit mode is silently taken over. Since decisions/sqlite there
   is no external file change any more; the guard is the row version `rev`.
   The text of a chapter is edited in its edit mode on its reading view
   (`/campaigns/:id/chapters/<id>`), with the same conflict line. The
   campaign is written like every entity via its resource
   (`PATCH /campaigns/:id`); its route is the chapter overview. The header of
   the chapter overview stays untouched: its single edit action opens the
   edit-campaign dialog over name, description and `body` — the text as
   Markdown —, with the same conflict line,
   whose save-anyway action writes only the changed fields.
10. Cold start: empty instance without seed — since decisions/sqlite the
    normal case of a fresh installation → create a campaign → chapter →
    scene → fill the scene → start a session → scene usable in the session
    view; every new scene attaches to the end of its chapter, a chapter
    change to the end of the target chapter; plus creating an NPC/location
    from their lists, the self-chosen identifier in the create dialog
    (pencil, an invalid identifier blocks the create action, an empty field
    derives it from the name again) and the slug collision (409 with a
    suggestion, writes nothing)
11. Trash (decisions/trash): delete an idea in the debrief (`DELETE
    …/ideas/<id> { rev }`, no confirmation) → a notice with an undo action
    restores it (`PATCH …/ideas/<id> { rev, deletedMs: null }` with the `rev`
    the deletion answered with); delete it again → the trash page
    (`/campaigns/:id/trash`, reached from the campaign menu, on the desktop
    and on the phone, and ⌘K) lists it with the
    days it has left and restores it. A chapter deleted with its scenes is ONE
    row of the page, naming how many scenes come back with it, and its restore
    brings them back in their order; a restore that something in the trash
    stands in the way of (`restore_blocked`, `chapter_in_trash`) names what in
    a whole sentence and writes nothing. The page fits 390px. Plus deleting
    from the edit mode of a scene, an NPC, a location or a chapter: its
    delete action asks first (the dialog says what goes along — a chapter's
    scenes and threads — and that unsaved changes are discarded, and the
    unsaved-changes guard does not ask again), `DELETE …/<entity>/<id>
    { rev }` → the chapter overview (scene, chapter) or the list (NPC,
    location) without the row, and the undo notice restores it (a scene at
    the end of its chapter, decisions/trash); a blocked delete
    (`trash_blocked`, e.g. an NPC a live scene names) names what is in the
    way in the dialog and writes nothing. The delete action is reachable at
    390px
12. Item prices (decisions/reference-data): the campaign menu opens
    `/campaigns/:id/item-prices`, which lists every price of Saidoro's "Sane
    Magic Item Prices" and, for the items it has none for, the SRD 5.2's
    value for the rarity (`GET /api/item-prices`, written by the migration,
    no seed), and names both sources with a link; searching an item,
    filtering by list or by rarity value and sorting by price narrow and
    order the list. The DM imports an own item list there from a JSON file
    (`PUT /api/item-price-imports/<id>`): a file that is no list says why in
    a whole sentence and writes nothing; the list's items stand priced by
    their rarity and name the list, an item the price list already has keeps
    its price and is counted as skipped, the list filter shows only them,
    and removing the list (`DELETE …/item-price-imports/<id> { rev }`) takes
    its items along. The page fits 390px
13. Random tables (decisions/reference-data): the campaign menu opens
    `/campaigns/:id/random-tables`, empty on a fresh instance (nothing ships,
    no seed); a 5etools file picked from disk is imported (`POST
    /api/random-table-sources`, the app sends the file's content) and its
    source is listed with title, authors and link; a table opened from it
    rolls a row by its dice ranges and shows the number and the row; the
    result becomes a log line of the running session (`POST …/log`) or,
    without one, an idea (`POST …/ideas`), each beginning with the table's
    name; a file that is no 5etools file writes nothing and says so in a
    whole sentence; removing the source asks first (`DELETE
    /api/random-table-sources/<id> { rev }`) and takes its tables along.
    The page fits 390px. The suite imports a small table written for it;
    no published table is in the repository

Rule for new features: every ready ticket names the critical paths it
touches; whoever touches or creates one extends the E2E suite in the same
PR — otherwise no merge.

## Quality floor (non-negotiable)

- Responsive down to mobile (mobile = search, reading view, ideas — see
  UI-BRIEF)
- Dark mode is the primary mode; light mode must work
- Visible keyboard focus; respect `prefers-reduced-motion`
- No localStorage persistence for data — the server is the truth
