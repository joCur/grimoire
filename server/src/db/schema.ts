// The Grimoire database schema — the ONE place the storage shape is written
// down in code (planning #52 Fassung 3, section 2; issue #54).
//
// Design rules, taken verbatim from the planning and binding for every table
// added later:
//
//   1. CONTRACT FIELDS ARE COLUMNS. Everything README.md names for an entity
//      gets its own column. Unknown keys an import brings along are kept
//      verbatim in the `extra` JSON column — the format degrades, it never
//      validates — and the API adds none (`PATCH` refuses a new key).
//   2. REFERENCES ARE TABLES with a `pos` column. `npcs: [jorna, fenn]` is an
//      ORDERED list in the file, and the order is authored information.
//   3. SOFT REFERENCES CARRY NO FOREIGN KEY. `scenes.location`, `scene_npcs.
//      npc_id`, `npc_relations.other_npc_id` may hold an id that has no row.
//      A FK there would turn a legal campaign into a failed import — of the
//      file tree, and of a `location:` that is FREE TEXT (README).
//      REVISED BY ISSUE #70: a dangling reference is no longer a state the
//      app produces. Every write that INTRODUCES a reference creates the
//      referenced row in the same transaction (store/write.ts
//      `ensureNpcRow`), so a referenced entity is EMPTY, never MISSING — an
//      npc without information is a row with an id and a name (#52). The
//      missing FK is what keeps free text and imported stock legal, not a
//      licence for new holes.
//   4. `rev` IS THE ROW VERSION and replaces mtimeMs as the 409 guard. Every
//      row a client can PATCH has one; the store bumps it on every write.
//   5. NATURAL COMPOSITE KEYS, `ON UPDATE CASCADE`. The id IS the key
//      (README: "id ... NIE ändern (Referenzen!)"), and a rename is then a
//      PK update the database cascades instead of a file-tree rewrite
//      (Scheibe 3, issues #29/#30).
//   6. SESSION TIMESTAMPS STAY ZONE-LESS STRINGS, exactly as the files carry
//      them. Only the server resolves them to epoch ms (see clock.ts) —
//      storing an epoch here would bake today's timezone into the data.
//
// `extra` and the other JSON columns are plain TEXT holding a JSON document;
// pack/unpack helpers live at the bottom of this file. Deliberately not
// drizzle's `mode: "json"`: the migration writes rows through raw SQL as well
// (FTS maintenance, custom migration), and one representation everywhere is
// worth more than the small convenience.

import { sql } from "drizzle-orm";
import {
  foreignKey,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * JSON object column holding unknown properties. Only the importer puts keys
 * in here (a seeded entry may carry fields the schema has no column for);
 * the API keeps them readable and lets `PATCH /properties` change or delete
 * them, but never adds a new one — an unknown key in a patch is a 400.
 */
const extraColumn = () => text("extra").notNull().default("{}");

/** Optimistic-concurrency token of one row (rule 4). */
const revColumn = () => integer("rev").notNull().default(1);

// --- campaign ---------------------------------------------------------------

/**
 * One campaign. `id` is what used to be the directory name under
 * the import source tree and stays the key in every URL.
 *
 * `version` replaces the chokidar-fed in-memory counter behind
 * `GET /api/:campaign/version` (DECISIONS #9): with the database as the only
 * truth there is no external editor to watch, so the counter is simply bumped
 * by whoever writes.
 */
export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  /** Display name from `_campaign.md`; empty string when the file said nothing. */
  name: text("name").notNull().default(""),
  description: text("description"),
  /** Free note space — the campaign file's markdown body. */
  body: text("body").notNull().default(""),
  extra: extraColumn(),
  /** Bumped on every write; the app polls it to invalidate its queries. */
  version: integer("version").notNull().default(1),
  rev: revColumn(),
  /**
   * The glossary's PROSE PREAMBLE — the text of `glossary.md` above the first
   * heading, which belongs to no term (see `parseGlossaryBody`). It has no
   * row of its own and would be lost on every save, so it lives here and is
   * rendered back in front of the term list. Empty for the usual glossary.
   */
  glossaryIntro: text("glossary_intro").notNull().default(""),
  /**
   * Guard tokens of the two SINGLETON LIST documents (`glossary.md`,
   * `inbox.md`). Neither is a single row that could carry a `rev`, and using
   * `version` for it — which every unrelated write bumps — made an open
   * glossary edit unsaveable during a running session. These count only
   * their own document's writes, so `mtimeMs` behaves exactly like an
   * entity's `rev`.
   */
  glossaryRev: integer("glossary_rev").notNull().default(1),
  inboxRev: integer("inbox_rev").notNull().default(1),
  /**
   * Guard token of the CAMPAIGN KNOWLEDGE list (issue #53). Third of the same
   * kind as the two above and for the same reason: `campaign_knowledge` is a
   * whole-list document, so the version belongs to the LIST and not to a row
   * — and `campaigns.version`, which every unrelated write bumps, would make
   * an open knowledge edit unsaveable during a running session.
   */
  knowledgeRev: integer("knowledge_rev").notNull().default(1),
});

// --- chapters ---------------------------------------------------------------

export const chapters = sqliteTable(
  "chapters",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onUpdate: "cascade", onDelete: "cascade" }),
    /** Chapter id — the former directory name, e.g. "01-salzhafen". */
    id: text("id").notNull(),
    title: text("title").notNull().default(""),
    status: text("status"),
    body: text("body").notNull().default(""),
    extra: extraColumn(),
    /** Display order; the migration numbers chapters by their directory order. */
    pos: integer("pos").notNull().default(0),
    rev: revColumn(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.id] })],
);

// --- scenes -----------------------------------------------------------------

export const scenes = sqliteTable(
  "scenes",
  {
    campaignId: text("campaign_id").notNull(),
    id: text("id").notNull(),
    /**
     * Owning chapter. A SOFT reference (rule 3): a scene may name a chapter
     * that has no `_chapter.md` and, in the file tree, a scene's `chapter`
     * frontmatter could disagree with its directory. The migration fills it
     * from the directory, which is what the tree was actually built from.
     */
    chapterId: text("chapter_id"),
    title: text("title").notNull().default(""),
    /** "planned" | "contingency" | anything else a file carried. */
    type: text("type").notNull().default("planned"),
    /** Free-text firing condition — only meaningful for contingency scenes. */
    trigger: text("trigger"),
    /**
     * The scene's location — a location ID or null, never free text
     * (issue #100). Soft reference (rule 3) in the database sense: the write
     * layer CREATES the row when the id has none (`ensureLocationRow`), so a
     * dangling value is impossible from the API side, but the column carries
     * no foreign key so the importer stays order-independent.
     *
     * It is also the scene's GROUP: the address `<chapter>/<location>/<id>`
     * and the tree's `SceneGroup`s are derived from this column, which is why
     * the old independent `group_slug` is gone (migration 0009, ADR #17).
     */
    location: text("location"),
    /** "draft" | "ready" | "played" | "dropped" | anything else. */
    status: text("status").notNull().default("draft"),
    /**
     * Roll20 handout NAMES, as a JSON string array. Deliberately a column and
     * not a join table: handouts are opaque external strings, nothing ever
     * joins on them, and the planning's table list has no table for them.
     * Order is preserved because the JSON array preserves it.
     */
    handouts: text("handouts").notNull().default("[]"),
    /** The markdown body — ONE field, editable as markdown (planning F-neu-3). */
    body: text("body").notNull().default(""),
    extra: extraColumn(),
    pos: integer("pos").notNull().default(0),
    rev: revColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.id] }),
    foreignKey({
      columns: [t.campaignId],
      foreignColumns: [campaigns.id],
      name: "scenes_campaign_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

/** Ordered npc references of a scene (`npcs: [...]`). */
export const sceneNpcs = sqliteTable(
  "scene_npcs",
  {
    campaignId: text("campaign_id").notNull(),
    sceneId: text("scene_id").notNull(),
    /** Soft reference (rule 3): an npc without a file is legal. */
    npcId: text("npc_id").notNull(),
    pos: integer("pos").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.sceneId, t.npcId] }),
    foreignKey({
      columns: [t.campaignId, t.sceneId],
      foreignColumns: [scenes.campaignId, scenes.id],
      name: "scene_npcs_scene_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

/** Ordered tags of a scene (`tags: [...]`). */
export const sceneTags = sqliteTable(
  "scene_tags",
  {
    campaignId: text("campaign_id").notNull(),
    sceneId: text("scene_id").notNull(),
    tag: text("tag").notNull(),
    pos: integer("pos").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.sceneId, t.tag] }),
    foreignKey({
      columns: [t.campaignId, t.sceneId],
      foreignColumns: [scenes.campaignId, scenes.id],
      name: "scene_tags_scene_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

// --- npcs -------------------------------------------------------------------

export const npcs = sqliteTable(
  "npcs",
  {
    campaignId: text("campaign_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull().default(""),
    role: text("role"),
    /** Chapter the npc is introduced in — soft reference (rule 3). */
    chapterId: text("chapter_id"),
    /** "alive" | "dead" | "missing" | "unknown" | anything else. */
    status: text("status").notNull().default("unknown"),
    /** `Roll20: <sheet>` — a reference, never a copy (DECISIONS #2). */
    statblock: text("statblock"),
    /** Free-form social stats as a JSON object, e.g. `{"wis":"+2"}`. */
    quickstats: text("quickstats").notNull().default("{}"),
    voice: text("voice"),
    appearance: text("appearance"),
    body: text("body").notNull().default(""),
    extra: extraColumn(),
    rev: revColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.id] }),
    foreignKey({
      columns: [t.campaignId],
      foreignColumns: [campaigns.id],
      name: "npcs_campaign_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

/**
 * One line of an npc's `## Beziehungen` list (`- <npc-id>: <Freitext>`).
 * `otherNpcId` is a soft reference — the counterpart may have no file.
 */
export const npcRelations = sqliteTable(
  "npc_relations",
  {
    campaignId: text("campaign_id").notNull(),
    npcId: text("npc_id").notNull(),
    otherNpcId: text("other_npc_id").notNull(),
    /** The free text after the colon. */
    note: text("note").notNull().default(""),
    pos: integer("pos").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.npcId, t.otherNpcId] }),
    foreignKey({
      columns: [t.campaignId, t.npcId],
      foreignColumns: [npcs.campaignId, npcs.id],
      name: "npc_relations_npc_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

// --- locations --------------------------------------------------------------

export const locations = sqliteTable(
  "locations",
  {
    campaignId: text("campaign_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull().default(""),
    chapterId: text("chapter_id"),
    /** Reference to the Roll20 page — never a map copy (DECISIONS #2). */
    roll20Page: text("roll20_page"),
    body: text("body").notNull().default(""),
    extra: extraColumn(),
    rev: revColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.id] }),
    foreignKey({
      columns: [t.campaignId],
      foreignColumns: [campaigns.id],
      name: "locations_campaign_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

// --- sessions ---------------------------------------------------------------

/**
 * One game session. `started`/`ended` keep the zone-less wall-clock strings
 * of the file format (rule 6); the epoch reading stays the server's job.
 * An `ended` that is NULL or blank means the session runs (session-state.ts).
 *
 * IDENTITY (issue #58, PO decision): the id of a NEW session is an OPAQUE
 * RANDOM string — `crypto.randomUUID()` (store/write.ts `newSessionId`).
 * Nobody reads it: it is an address (`sessions/<id>.md`) and nothing else,
 * and everything DISPLAYABLE about a session is derived from `started`.
 *
 * Why randomUUID and not a ULID or a date+sequence: it is URL-safe, needs no
 * new npm dependency AND no hand-rolled encoder (node:crypto ships it), and —
 * unlike a ULID — it carries no timestamp, so no reader can be tempted to
 * order sessions by their id again. It also needs no coordination at all: the
 * former `yyyy-mm-dd-<n>` scheme required a persisted per-day high-water mark
 * so a discarded session's id could never be re-issued. That whole machinery
 * is gone.
 *
 * COMPATIBILITY: session ids are plain strings, so the date-shaped ids written
 * before this (`2026-01-15`, `2026-01-15-2`) stay valid and need no migration.
 * They simply are not parsed any more.
 *
 * ORDER is `started` alone (store/read.ts `compareSessionsNewestFirst`), with
 * `createdAt` as the tie-break — see that column.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    campaignId: text("campaign_id").notNull(),
    /** Opaque random id (see above); older rows carry a date-shaped id. */
    id: text("id").notNull(),
    started: text("started"),
    ended: text("ended"),
    /**
     * INSERTION ORDER of the row in epoch MILLISECONDS — the tie-break behind
     * `started`, which is only second-precise. "Start, beenden, wieder
     * starten" inside one second gives two rows the same `started`, and "die
     * zuletzt gestartete" has to be the second of them deterministically. The
     * opaque id cannot answer that (it has no time in it), so the row records
     * when it was written.
     *
     * NOT a wall-clock string like `started`: this is bookkeeping of the
     * database, never file content, and the file format has no field for it.
     * It is also STRICTLY INCREASING per campaign rather than a plain
     * `Date.now()` (store/write.ts `nextCreatedAt`) — a clock that stands
     * still or jumps back must not make two rows unorderable.
     *
     * `0` for rows written before the column existed and for the markdown
     * import — they then fall back to the id compare, which only ever decides
     * between sessions that already share a `started`.
     */
    createdAt: integer("created_at").notNull().default(0),
    /**
     * Everything in the session file that is neither `## Log` nor
     * frontmatter — `## Threads` above all. Kept as one markdown field so no
     * hand-written section is lost.
     */
    body: text("body").notNull().default(""),
    extra: extraColumn(),
    rev: revColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.id] }),
    foreignKey({
      columns: [t.campaignId],
      foreignColumns: [campaigns.id],
      name: "sessions_campaign_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

/**
 * One pause interval of a session, second-precise and zone-less like
 * `started`/`ended`. `toTs` NULL is the RUNNING pause (README, issue #40 AK8).
 * `pos` is the position in the file's list and therefore the key — two pauses
 * may legitimately share a `from`.
 */
export const sessionPauses = sqliteTable(
  "session_pauses",
  {
    campaignId: text("campaign_id").notNull(),
    sessionId: text("session_id").notNull(),
    pos: integer("pos").notNull(),
    fromTs: text("from_ts").notNull(),
    toTs: text("to_ts"),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.sessionId, t.pos] }),
    foreignKey({
      columns: [t.campaignId, t.sessionId],
      foreignColumns: [sessions.campaignId, sessions.id],
      name: "session_pauses_session_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

/**
 * One line of a session's `## Log`. APPEND-ONLY stays the rule; `pos` is the
 * append counter and the key.
 *
 * `raw` is the line exactly as it stood in the file and is the only NOT NULL
 * content column: a line the log grammar does not recognise (a hand-typed
 * note, a `- Pause` marker in an older spelling) keeps its `raw` and leaves
 * `at`/`sceneId`/`text` NULL rather than being dropped or guessed at.
 *
 * `hash` is the short hash (first 8 hex chars of SHA-256 over `raw`) the
 * review step used to mark lines as seen. It is kept because it is the id the
 * app's review already speaks — but `reviewed` is now a plain flag on the row
 * instead of a hash list in the frontmatter.
 */
export const logEntries = sqliteTable(
  "log_entries",
  {
    campaignId: text("campaign_id").notNull(),
    sessionId: text("session_id").notNull(),
    pos: integer("pos").notNull(),
    raw: text("raw").notNull(),
    /** `HH:MM` as written; NULL for a line that carries no timestamp. */
    at: text("at"),
    /** Scene context in parentheses — a soft reference (rule 3). */
    sceneId: text("scene_id"),
    /** The line's text without time and scene prefix; NULL for a raw-only line. */
    text: text("text"),
    /** Short hash of `raw` — the review's stable line id. */
    hash: text("hash").notNull().default(""),
    reviewed: integer("reviewed").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.sessionId, t.pos] }),
    foreignKey({
      columns: [t.campaignId, t.sessionId],
      foreignColumns: [sessions.campaignId, sessions.id],
      name: "log_entries_session_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

/**
 * `scenes_played: [...]` of a session — ordered, soft scene references.
 *
 * The key is (campaign, session, POS), not (…, scene): the list is a
 * SEQUENCE, and a scene the party returned to later stands in it twice. A
 * scene-keyed table swallowed that repetition, and with it the order the
 * review reads the evening back in.
 */
export const sessionScenesPlayed = sqliteTable(
  "session_scenes_played",
  {
    campaignId: text("campaign_id").notNull(),
    sessionId: text("session_id").notNull(),
    sceneId: text("scene_id").notNull(),
    pos: integer("pos").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.sessionId, t.pos] }),
    foreignKey({
      columns: [t.campaignId, t.sessionId],
      foreignColumns: [sessions.campaignId, sessions.id],
      name: "session_scenes_played_session_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

// --- inbox ------------------------------------------------------------------

/**
 * One line of the campaign inbox. Same append-only-plus-one-exception rule as
 * the file had (README: a done entry is rewritten to `- [x] …`) — here that
 * exception is the `done` flag.
 *
 * As in `log_entries`, `raw` is the line verbatim and the only guaranteed
 * content: the inbox file also holds headings and prose, and those keep their
 * place in the list with `text` NULL instead of being thrown away.
 */
export const inboxEntries = sqliteTable(
  "inbox_entries",
  {
    campaignId: text("campaign_id").notNull(),
    pos: integer("pos").notNull(),
    raw: text("raw").notNull(),
    /** The entry text without the list/checkbox marker; NULL for a raw-only line. */
    text: text("text"),
    done: integer("done").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.pos] }),
    foreignKey({
      columns: [t.campaignId],
      foreignColumns: [campaigns.id],
      name: "inbox_entries_campaign_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

// --- glossary ---------------------------------------------------------------

/**
 * The translation glossary as a STRUCTURED table (planning F6, revised by the
 * PO): term → explanation instead of one markdown blob. Issue #53 builds the
 * generator knowledge base on exactly this table.
 */
export const glossary = sqliteTable(
  "glossary",
  {
    campaignId: text("campaign_id").notNull(),
    term: text("term").notNull(),
    explanation: text("explanation").notNull().default(""),
    /** Stable display order — the order the migration found the terms in. */
    pos: integer("pos").notNull(),
    rev: revColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.term] }),
    foreignKey({
      columns: [t.campaignId],
      foreignColumns: [campaigns.id],
      name: "glossary_campaign_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

// --- campaign knowledge -----------------------------------------------------

/**
 * The campaign's KNOWLEDGE BASE for the generator (issue #53): naming
 * conventions, facts and style rules the model has to apply even when the
 * source material says something else.
 *
 * Its own table next to `glossary`, per PO decision, because it answers a
 * different question: the glossary translates a TERM, an entry here overrides
 * the source. `kind` decides which columns carry the content (`naming`:
 * `from_text`/`to_text`, otherwise `text`) — the unused ones stay empty
 * strings rather than NULL, so nothing has to distinguish "not set" from
 * "cleared" and a kind switched in the UI keeps what was typed.
 *
 * THE KEY IS (campaign, pos), not the content. The list is short, ordered and
 * REPLACED AS A WHOLE (like the glossary), so `pos` is both the display order
 * — which is authored information (schema rule 2) — and the only identity an
 * entry needs. A content key would also forbid two identical style rules,
 * which is a rule nobody asked for.
 *
 * `rev` is on the row for schema rule 4's sake; the guard the API actually
 * checks is the LIST's `campaigns.knowledge_rev` (see there).
 */
export const campaignKnowledge = sqliteTable(
  "campaign_knowledge",
  {
    campaignId: text("campaign_id").notNull(),
    /** Position in the list — the display order AND the key (see above). */
    pos: integer("pos").notNull(),
    /** "naming" | "fact" | "style" (shared KNOWLEDGE_KINDS). */
    kind: text("kind").notNull().default("fact"),
    /**
     * `naming`: the spelling the SOURCE material uses. Named `from_text`
     * because `from` is a SQL keyword and a quoted column name would leak
     * into every raw `sql` template that ever touches this table.
     */
    fromText: text("from_text").notNull().default(""),
    /** `naming`: the spelling THIS campaign uses. */
    toText: text("to_text").notNull().default(""),
    /** `fact`/`style`: the sentence. */
    text: text("text").notNull().default(""),
    rev: revColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.pos] }),
    foreignKey({
      columns: [t.campaignId],
      foreignColumns: [campaigns.id],
      name: "campaign_knowledge_campaign_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

// --- generator jobs ---------------------------------------------------------

/**
 * The generate job of a campaign (issue #23 / ADR #10 addendum). Still at
 * most one per campaign; persisting it is what Scheibe 4 switches on. The
 * result/error/edit payloads stay JSON: they are the API's own shapes
 * (`GenerateResult`, `GenerateJobError`, `draftEdits`) and nothing queries
 * inside them.
 *
 * "At most one per campaign" is a CONSTRAINT, not a convention: the unique
 * index on `campaign_id` makes every read a single lookup (no ordering
 * question) and turns a bug that inserted a second row into an error at the
 * insert instead of a job that randomly shadows another one.
 */
export const generateJobs = sqliteTable(
  "generate_jobs",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onUpdate: "cascade", onDelete: "cascade" }),
    /** "scene" | "npc" | "augment" (issue #36). */
    kind: text("kind").notNull().default("scene"),
    /**
     * Address of the entry an `augment` run targets (issue #36); NULL for the
     * two runs that CREATE something. Stored from the start of the run, so a
     * job that is still going can already name the entry it works on.
     */
    targetPath: text("target_path"),
    /** Target chapter of a scene run; NULL for an npc run. */
    chapter: text("chapter"),
    /** "running" | "done" | "failed". Boot turns leftover "running" into "failed". */
    status: text("status").notNull(),
    /** ISO timestamps on the server clock. */
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    result: text("result"),
    npcResult: text("npc_result"),
    /** The augment PROPOSAL (issue #36) — JSON, see AugmentResult. */
    augmentResult: text("augment_result"),
    error: text("error"),
    draftEdits: text("draft_edits").notNull().default("{}"),
    /**
     * The DM's REVIEW STATE (issue #97) — JSON, see `GenerateJobReview`:
     * the decision per suggested entry, the dropped scenes, the per
     * field/block decisions of an augment run and the parts a partial
     * accept already wrote. JSON for the same reason as the payloads above:
     * it is the API's own shape and nothing queries inside it.
     */
    review: text("review").notNull().default("{}"),
    /**
     * Optimistic-concurrency token of that review state. Two tabs on the
     * same review are the case it exists for: the second `PATCH …/review`
     * carries a stale rev and gets a 409 instead of overwriting the first.
     */
    rev: integer("rev").notNull().default(0),
    /**
     * The PIPELINE state of a scene run (issue #102) — JSON: the internal
     * outline, the parts with their per-part status/error/usage, and the
     * run's token and call totals. `{}` for the single-call runs (npc,
     * augment) and for a row written before this deploy, which is what makes
     * the column additive: a job without parts renders exactly as it did.
     */
    pipeline: text("pipeline").notNull().default("{}"),
    /**
     * The run's source material, kept because a per-part RETRY has to send
     * the same excerpt again (issue #102) — and a retry may happen after a
     * restart, when nothing but the row is left. Only a scene run stores it.
     */
    sourceText: text("source_text"),
    /** The run's „Neues Kapitel" flag — a retry must not 404 on it. */
    newChapter: integer("new_chapter").notNull().default(0),
  },
  (t) => [uniqueIndex("generate_jobs_campaign_unique").on(t.campaignId)],
);

// --- bookkeeping ------------------------------------------------------------

/**
 * Key/value bookkeeping of the database itself. Known keys:
 *   `migrated_at`   — ISO timestamp of the one-time migration. Its PRESENCE
 *                     is what makes the migration idempotent.
 *   `migrated_from` — the source directory the import read.
 *   `migrated_campaign:<id>`
 *                   — ISO timestamp of ONE campaign's committed import,
 *                     written inside that campaign's own transaction. This is
 *                     what lets a run interrupted between two campaigns
 *                     resume instead of dead-ending on "content, no marker".
 *
 * `session_seq:<campaign>:<date>` was such a key while session ids were
 * date+sequence; with opaque random ids (see `sessions`) nothing has to be
 * reserved any more. Old databases may still carry the keys — they are inert
 * and are deliberately not deleted (a `meta` row costs nothing and a migration
 * that removes bookkeeping can only fail).
 */
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// --- full-text search -------------------------------------------------------
//
// `search_fts` is an FTS5 virtual table and therefore NOT a drizzle table: it
// is created by the hand-written custom migration
// (0001_search_fts.sql) and maintained explicitly from the store layer.
// Drizzle would have to model contentless-external-content tables and shadow
// tables it has no concept of, and a generated diff would try to drop it on
// every subsequent `drizzle-kit generate`.
//
// Shape (see the migration for the authoritative DDL):
//   indexed:   title, ref, tags, body   — bm25 weights 10 / 6 / 4 / 1
//   unindexed: campaign_id, kind, entity_id
//   tokenizer: unicode61 remove_diacritics 2   (so "leuchtturm" finds
//              "Leuchtturm" and "muller" finds "Müller")

/** Table name of the FTS5 index — referenced from raw `sql` templates. */
export const SEARCH_FTS = "search_fts";

/** The bm25 ranking expression the search endpoint orders by. */
export const searchRank = sql`bm25(search_fts, 10, 6, 4, 1)`;

// --- JSON column helpers ----------------------------------------------------

/** Serialize an object for an `extra`/`quickstats`-style column. */
export function packJson(value: unknown): string {
  if (value === undefined || value === null) return "{}";
  try {
    const json = JSON.stringify(value);
    return json === undefined ? "{}" : json;
  } catch {
    return "{}"; // circular or otherwise unserializable — degrade, never throw
  }
}

/** Parse a JSON object column; anything unusable degrades to `{}`. */
export function unpackJson(value: string | null | undefined): Record<string, unknown> {
  if (value === undefined || value === null || value === "") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Parse a JSON string-array column (`scenes.handouts`); degrades to `[]`. */
export function unpackStringArray(value: string | null | undefined): string[] {
  if (value === undefined || value === null || value === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => v !== null && v !== undefined).map((v) => String(v));
  } catch {
    return [];
  }
}

/** Every table of the schema, for `drizzle({ schema })` and drizzle-kit. */
export const schema = {
  campaigns,
  chapters,
  scenes,
  sceneNpcs,
  sceneTags,
  npcs,
  npcRelations,
  locations,
  sessions,
  sessionPauses,
  logEntries,
  sessionScenesPlayed,
  inboxEntries,
  glossary,
  campaignKnowledge,
  generateJobs,
  meta,
};
