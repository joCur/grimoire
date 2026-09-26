// The Grimoire database schema — the ONE place the storage shape is written
// down in code.
//
// Design rules, binding for every table added later:
//
//   1. CONTRACT FIELDS ARE COLUMNS, and there is nothing beside them.
//      Everything README.md names for an entity gets its own column; a key
//      the contract does not name has no field behind it and is refused
//      (a PATCH answers 400, and so does a seed). The contract is the
//      entity's zod schema (ADR #31).
//   2. REFERENCES ARE TABLES with a `pos` column. `npcs: [jorna, fenn]` is an
//      ORDERED list, and the order is authored information.
//   3. EVERY REFERENCE IS A FOREIGN KEY. A scene's chapter and location, the
//      npcs of a scene, the chapter of an npc, a location and a thread, the
//      scene of a log entry and of a played scene each carry a
//      composite `(campaign_id, <ref>)` foreign key with
//      `ON UPDATE CASCADE` (rule 5) and `ON DELETE NO ACTION`. So a stored
//      reference names an entry that EXISTS, and the database is what
//      guarantees it. Nullable where the reference may be absent;
//      `scenes.chapter_id` is NOT NULL, because a scene belongs to a
//      chapter.
//      TWO CONSEQUENCES, and they are the point. A write that names an
//      entry which does not exist is refused (400) instead of storing a
//      hole, and NOTHING creates an entry because something mentioned it.
//      The creation paths are: the create endpoints (the review's create-npc
//      action from a log entry among them), accepting a generator
//      proposal — and, inside that
//      accept, the chapter a new-chapter run decided on. Nowhere else.
//      A `[[slug]]` in prose is not a
//      reference in this sense: it is body text, it stays visible text, and
//      it constrains nothing — which is also why an npc's `## Beziehungen`
//      is prose and has no table: nothing in the storage is derived from
//      body text.
//      The one UNCONSTRAINED reference is `generate_jobs.chapter`: a run
//      for a new chapter names the chapter it is about to create.
//   4. `rev` IS THE ROW VERSION and replaces mtimeMs as the 409 guard. Every
//      row a client can PATCH has one; the store bumps it on every write.
//   5. NATURAL COMPOSITE KEYS, `ON UPDATE CASCADE`. The id IS the key and is
//      set once, at creation (ADR #21); the cascade is what keeps a child row
//      honest, not a feature that changes ids.
//   6. SESSION TIMESTAMPS STAY ZONE-LESS STRINGS, exactly as they were
//      written, in the one shape store/time.ts spells out. Only the server
//      resolves them to epoch ms (see store/time.ts) —
//      storing an epoch here would bake today's timezone into the data.
//   7. A CLOSED VALUE SET IS A CHECK CONSTRAINT. `scenes.status`,
//      `scenes.type`, `npcs.status` and `chapters.status` each hold one of a
//      fixed handful of positions, and the database is what says so (ADR
//      #25). The allowed values are NOT written here: they are the lists in
//      @grimoire/shared, and `oneOf` below turns a list into the constraint.
//      A degrading READER (README) and a closed COLUMN are not in conflict —
//      the renderer still shows whatever it is handed, there simply is no
//      longer a way to get a foreign value into the column.
//
// The JSON columns (`quickstats`, `handouts`) are plain TEXT holding JSON;
// pack/unpack helpers live at the bottom of this file. Deliberately not
// drizzle's `mode: "json"`: rows are written through raw SQL as well (FTS
// maintenance, custom migrations), and one representation everywhere is worth
// more than the small convenience.

import { sql, type SQL } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { NPC_STATUSES } from "@grimoire/shared/npc";
import { SCENE_STATUSES, SCENE_TYPES } from "@grimoire/shared/scene";
import { CHAPTER_STATUSES } from "@grimoire/shared/chapter";

/** Optimistic-concurrency token of one row (rule 4). */
const revColumn = () => integer("rev").notNull().default(1);

/**
 * `<column> in ('a', 'b')` for a CHECK constraint (rule 7), built from the
 * shared value list. The list is the single source: a value added to
 * @grimoire/shared changes the constraint, and no enum is ever spelled twice.
 *
 * `sql.raw` because the values go into the table DEFINITION, where a bound
 * parameter has no meaning — the migration SQL has to carry the literals.
 * They come from a `const` tuple of identifiers, never from a request.
 *
 * `nullable` adds the `is null` arm: a column that may hold nothing must
 * still accept nothing, and a bare `in (…)` would evaluate to NULL there —
 * which SQLite passes, but only by accident of three-valued logic.
 */
function oneOf(column: string, values: readonly string[], nullable = false): SQL {
  const list = values.map((value) => `'${value}'`).join(", ");
  const test = `\`${column}\` in (${list})`;
  return sql.raw(nullable ? `\`${column}\` is null or ${test}` : test);
}

// --- campaign ---------------------------------------------------------------

/**
 * One campaign. `id` is the key in every URL.
 *
 * `version` is the counter behind `GET /api/campaigns/:campaign/version`
 * (DECISIONS #9). With the database as the only truth there is nothing outside
 * the server that could change campaign content, so the counter is simply
 * bumped by whoever writes — no watcher is involved.
 */
export const campaigns = sqliteTable("campaigns", {
  id: text("id").primaryKey(),
  /** Display name; empty string when none was authored (the id is then shown). */
  name: text("name").notNull().default(""),
  description: text("description"),
  /** Free note space — the campaign's markdown body. */
  body: text("body").notNull().default(""),
  /** Bumped on every write; the app polls it to invalidate its queries. */
  version: integer("version").notNull().default(1),
  rev: revColumn(),
  /**
   * The markdown the glossary page shows above the terms — prose that belongs
   * to no single term. A field of the campaign (`glossaryIntro`), written
   * with the campaign's own PATCH; empty for the usual glossary.
   */
  glossaryIntro: text("glossary_intro").notNull().default(""),
  /**
   * Guard token of the campaign's KNOWLEDGE-ITEM ORDER — the `pos` values of
   * `knowledge_items`, which `PUT /knowledge-item-order` writes as a whole.
   *
   * Its own counter, like `chapters.scene_order_rev`: the order is a statement
   * of the campaign about its knowledge items, and neither `rev` — which every
   * write of the campaign's fields bumps — nor an item's `rev` may move when
   * the items are rearranged, or reordering would turn an open editor into a
   * conflict. It moves with every change of the order: a reorder, a new item
   * at the end, an item removed.
   */
  knowledgeItemOrderRev: integer("knowledge_item_order_rev").notNull().default(1),
});

// --- chapters ---------------------------------------------------------------

export const chapters = sqliteTable(
  "chapters",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onUpdate: "cascade", onDelete: "cascade" }),
    /** Chapter id, e.g. "01-salzhafen". */
    id: text("id").notNull(),
    title: text("title").notNull().default(""),
    /**
     * `planned | active | done` (@grimoire/shared `CHAPTER_STATUSES`), or
     * nothing: a chapter without a status is a legal chapter, and clearing
     * the field is how it loses one. A CHECK holds the trio (rule 7), and at
     * most ONE chapter per campaign holds `active` (store/chapters.ts
     * `clearOtherActiveChapters`) — that second rule is the store's, because
     * it spans rows.
     */
    status: text("status"),
    body: text("body").notNull().default(""),
    /** Display order. */
    pos: integer("pos").notNull().default(0),
    rev: revColumn(),
    /**
     * Guard token of the chapter's SCENE ORDER — the `pos` values of the
     * scenes below it, which `PUT /chapters/:chapter/scene-order` writes as a
     * whole.
     *
     * Its own counter, for the reason `campaigns.knowledge_item_order_rev`
     * has its own: the order lives on its own, and `rev` —
     * which every unrelated write of the chapter bumps — would make an open
     * chapter-text edit unsaveable the moment somebody rearranges the scenes.
     * The other direction holds too, which is the one that bites: reordering
     * must not 409 an editor it has nothing to do with. So the order counts
     * only its own writes, and `rev` counts only the chapter's.
     */
    sceneOrderRev: integer("scene_order_rev").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.id] }),
    check("chapters_status_check", oneOf("status", CHAPTER_STATUSES, true)),
  ],
);

// --- threads ------------------------------------------------------------------

/**
 * One THREAD — a storyline the DM keeps track of — as its own row (ADR #29,
 * ADR #31): what the review writes and the chapter overview reads back is a
 * row with columns, never a line found under a heading of a chapter's text.
 *
 * `id` is an OPAQUE random string (store/threads.ts), unique per campaign —
 * not per chapter and not the position — so a thread keeps its identity
 * through every edit and a move to another chapter.
 *
 * `chapter_id` is the chapter that carries it: NOT NULL and a foreign key
 * (rule 3). It may change, and the thread's URL does not, because a thread
 * lies flat under its campaign. A chapter's removal would take its threads
 * with it (`ON DELETE CASCADE`) — there is no delete path for chapters, the
 * rule only says whose rows these are.
 *
 * `pos` is the order of creation — a new thread gets one past the highest of
 * the campaign, a sort key with gaps allowed — and nothing reorders it. `rev`
 * is the thread's own guard (rule 4).
 */
export const threads = sqliteTable(
  "threads",
  {
    campaignId: text("campaign_id").notNull(),
    /** Opaque random id — the row's identity on the wire. */
    id: text("id").notNull(),
    /** The owning chapter — a foreign key (rule 3). */
    chapterId: text("chapter_id").notNull(),
    /** The thread as the DM wrote it, one line. */
    text: text("text").notNull(),
    done: integer("done").notNull().default(0),
    pos: integer("pos").notNull(),
    rev: revColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.id] }),
    foreignKey({
      columns: [t.campaignId, t.chapterId],
      foreignColumns: [chapters.campaignId, chapters.id],
      name: "threads_chapter_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

// --- scenes -----------------------------------------------------------------

export const scenes = sqliteTable(
  "scenes",
  {
    campaignId: text("campaign_id").notNull(),
    id: text("id").notNull(),
    /**
     * Owning chapter — NOT NULL and a foreign key (rule 3). A scene belongs
     * to a chapter: the chapter lists it, so a scene without one would be
     * listed nowhere. It may change; it is never cleared.
     */
    chapterId: text("chapter_id").notNull(),
    title: text("title").notNull().default(""),
    /** `planned | contingency` (shared `SCENE_TYPES`), held by a CHECK. */
    type: text("type").notNull().default("planned"),
    /** Free-text firing condition — only meaningful for contingency scenes. */
    trigger: text("trigger"),
    /**
     * The scene's location — a foreign key to an existing location, or null
     * when the scene names none. Never free text. It does not order
     * anything: `pos` below does that.
     */
    location: text("location"),
    /** `draft | ready | played | dropped` (shared `SCENE_STATUSES`), CHECKed. */
    status: text("status").notNull().default("draft"),
    /**
     * Roll20 handout NAMES, as a JSON string array. Deliberately a column and
     * not a join table: handouts are opaque external strings, nothing ever
     * joins on them, and no query needs a table for them.
     * Order is preserved because the JSON array preserves it.
     */
    handouts: text("handouts").notNull().default("[]"),
    /** The markdown body — ONE field, editable as markdown. */
    body: text("body").notNull().default(""),
    /**
     * Display order WITHIN THE CHAPTER, counted from 0 — the chapter lists
     * its scenes by it, with the id as the tie-break. A sort key, not an
     * index: gaps are fine.
     *
     * It is SET, never derived: creating a scene appends it to its chapter,
     * moving one to another chapter appends it there, an accepted scene of a
     * generator run takes the run's start plus its outline number
     * (store/chapters.ts `sceneRunPos`), and
     * `PUT /chapters/:chapter/scene-order` hands out the whole chapter's
     * positions from the order the DM dragged them into. Nothing reads an
     * ordering out of the title or the location.
     *
     * It is not a field of the scene either (@grimoire/shared/scene): the
     * position of a scene among its siblings is a statement about the
     * chapter, so it is written where the chapter is guarded, not with the
     * scene's own fields.
     */
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
    foreignKey({
      columns: [t.campaignId, t.chapterId],
      foreignColumns: [chapters.campaignId, chapters.id],
      name: "scenes_chapter_fk",
    })
      .onUpdate("cascade")
      .onDelete("no action"),
    foreignKey({
      columns: [t.campaignId, t.location],
      foreignColumns: [locations.campaignId, locations.id],
      name: "scenes_location_fk",
    })
      .onUpdate("cascade")
      .onDelete("no action"),
    check("scenes_status_check", oneOf("status", SCENE_STATUSES)),
    check("scenes_type_check", oneOf("type", SCENE_TYPES)),
  ],
);

/** Ordered npc references of a scene (`npcs: [...]`). */
export const sceneNpcs = sqliteTable(
  "scene_npcs",
  {
    campaignId: text("campaign_id").notNull(),
    sceneId: text("scene_id").notNull(),
    /** The npc — a foreign key to an existing entry (rule 3). */
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
    foreignKey({
      columns: [t.campaignId, t.npcId],
      foreignColumns: [npcs.campaignId, npcs.id],
      name: "scene_npcs_npc_fk",
    })
      .onUpdate("cascade")
      .onDelete("no action"),
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
    /**
     * Chapter the npc is introduced in — a foreign key (rule 3), null when
     * the npc belongs to no single chapter.
     */
    chapterId: text("chapter_id"),
    /** `alive | dead | missing | unknown` (shared `NPC_STATUSES`), CHECKed. */
    status: text("status").notNull().default("unknown"),
    /** `Roll20: <sheet>` — a reference, never a copy (DECISIONS #2). */
    statblock: text("statblock"),
    /** Free-form social stats as a JSON object, e.g. `{"wis":"+2"}`. */
    quickstats: text("quickstats").notNull().default("{}"),
    voice: text("voice"),
    appearance: text("appearance"),
    /**
     * What the npc wants — the line the npc card and the reference preview
     * show. A property, not a body section found by its heading: what a view
     * reads as data is a column (ADR #29).
     */
    motivation: text("motivation"),
    body: text("body").notNull().default(""),
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
    foreignKey({
      columns: [t.campaignId, t.chapterId],
      foreignColumns: [chapters.campaignId, chapters.id],
      name: "npcs_chapter_fk",
    })
      .onUpdate("cascade")
      .onDelete("no action"),
    check("npcs_status_check", oneOf("status", NPC_STATUSES)),
  ],
);

// An npc's `## Beziehungen` has NO TABLE. It is prose in the npc's body, and
// a counterpart a DM wants to link is a `[[id]]` like any other mention.
// Storage is never derived from body text: a relation list parsed out of a
// section would be a second, silent source of truth for something the DM
// wrote as a sentence. Relations as DATA would be properties, filled in the
// properties dialog and by the generator — not a parsed section.

// --- locations --------------------------------------------------------------

export const locations = sqliteTable(
  "locations",
  {
    campaignId: text("campaign_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull().default(""),
    /**
     * Chapter the location belongs to — a foreign key (rule 3), null when it
     * belongs to no single chapter.
     */
    chapterId: text("chapter_id"),
    /** Reference to the Roll20 page — never a map copy (DECISIONS #2). */
    roll20Page: text("roll20_page"),
    /**
     * What the place feels like — the line the location card and the
     * reference preview show. A property for the same reason as
     * `npcs.motivation` (ADR #29).
     */
    atmosphere: text("atmosphere"),
    body: text("body").notNull().default(""),
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
    foreignKey({
      columns: [t.campaignId, t.chapterId],
      foreignColumns: [chapters.campaignId, chapters.id],
      name: "locations_chapter_fk",
    })
      .onUpdate("cascade")
      .onDelete("no action"),
  ],
);

// --- sessions ---------------------------------------------------------------

/**
 * One game SESSION (ADR #31). `started`/`ended` keep the zone-less
 * wall-clock strings of rule 6; the epoch reading stays the server's job. An
 * `ended` that is NULL or blank means the session runs
 * (@grimoire/shared/session `isSessionEnded`).
 *
 * `id` is an OPAQUE random string (store/sessions.ts), the session's key on
 * the wire. Everything displayable about a session comes from `started`, so
 * nothing reads the id; date-shaped ids (`2026-01-15`) are just as valid and
 * are not parsed either.
 *
 * ORDER is `started` alone (store/session-rows.ts `compareSessionsNewestFirst`),
 * with `createdAt` as the tie-break — see that column. `rev` guards the
 * session's own fields; its pauses, log entries and played scenes carry
 * their own.
 */
export const sessions = sqliteTable(
  "sessions",
  {
    campaignId: text("campaign_id").notNull(),
    /** Opaque random id (see above). */
    id: text("id").notNull(),
    started: text("started"),
    ended: text("ended"),
    /**
     * INSERTION ORDER of the row in epoch MILLISECONDS — the tie-break behind
     * `started`, which is only second-precise. Start, end and start again
     * inside one second gives two rows the same `started`, and "the most
     * recently started" has to be the second of them deterministically. The
     * opaque id cannot answer that (it has no time in it), so the row records
     * when it was written.
     *
     * NOT a wall-clock string like `started`: this is bookkeeping of the
     * database and no field of the session. It is also STRICTLY INCREASING
     * per campaign rather than a plain `Date.now()` (store/sessions.ts
     * `nextCreatedAt`) — a clock that stands still or jumps back must not make
     * two rows unorderable.
     *
     * `0` for a seeded row: seeded sessions are ordered by `started`, and the
     * id compare decides between two that share it.
     */
    createdAt: integer("created_at").notNull().default(0),
    /** The session's free Markdown text. */
    body: text("body").notNull().default(""),
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
 * One PAUSE of a session (ADR #31), second-precise and zone-less like
 * `started`/`ended`. `toTs` NULL is the RUNNING pause: the session's clock
 * stands. `id` is an OPAQUE random string (store/pauses.ts), unique within
 * its session; `pos` is the order of creation. `rev` is the pause's own guard
 * (rule 4).
 */
export const pauses = sqliteTable(
  "pauses",
  {
    campaignId: text("campaign_id").notNull(),
    sessionId: text("session_id").notNull(),
    /** Opaque random id — the pause's identity on the wire. */
    id: text("id").notNull(),
    fromTs: text("from_ts").notNull(),
    toTs: text("to_ts"),
    pos: integer("pos").notNull(),
    rev: revColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.sessionId, t.id] }),
    foreignKey({
      columns: [t.campaignId, t.sessionId],
      foreignColumns: [sessions.campaignId, sessions.id],
      name: "pauses_session_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

/**
 * One LOG ENTRY of a session (ADR #31): a quick note the DM took. The log is
 * APPEND-ONLY — a note is written once, and the one thing that changes later
 * is `reviewed`, the review's flag on the row.
 *
 * COLUMNS ONLY: the note's time, the scene it was taken in, its text and the
 * review flag. `id` is an OPAQUE random string (store/log-entries.ts), unique
 * within its session; `pos` is the order of the log. `rev` is the entry's
 * own guard (rule 4).
 */
export const logEntries = sqliteTable(
  "log_entries",
  {
    campaignId: text("campaign_id").notNull(),
    sessionId: text("session_id").notNull(),
    /** Opaque random id — the log entry's identity on the wire. */
    id: text("id").notNull(),
    /** `HH:MM` local, the time the note was taken; NULL when it carries none. */
    at: text("at"),
    /**
     * The scene the note was taken in — a foreign key (rule 3), null for a
     * note that names none. The endpoint checks the reference, so a note is
     * never refused or thinned out over a scene it did not mean.
     */
    sceneId: text("scene_id"),
    /** The note as the DM typed it, hashtags included (README's vocabulary). */
    text: text("text").notNull().default(""),
    reviewed: integer("reviewed").notNull().default(0),
    pos: integer("pos").notNull(),
    rev: revColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.sessionId, t.id] }),
    foreignKey({
      columns: [t.campaignId, t.sessionId],
      foreignColumns: [sessions.campaignId, sessions.id],
      name: "log_entries_session_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
    foreignKey({
      columns: [t.campaignId, t.sceneId],
      foreignColumns: [scenes.campaignId, scenes.id],
      name: "log_entries_scene_fk",
    })
      .onUpdate("cascade")
      .onDelete("no action"),
  ],
);

/**
 * One PLAYED SCENE of a session (ADR #31): a step of the evening through the
 * scenes. The played scenes are a SEQUENCE — a scene the group returned to
 * later stands in it twice —, so the scene is no key: `id` is an OPAQUE
 * random string (store/played-scenes.ts), unique within its session, and
 * `pos` is the order of play. `rev` is the row's own guard (rule 4).
 */
export const playedScenes = sqliteTable(
  "played_scenes",
  {
    campaignId: text("campaign_id").notNull(),
    sessionId: text("session_id").notNull(),
    /** Opaque random id — the played scene's identity on the wire. */
    id: text("id").notNull(),
    /** The scene — a foreign key to an existing scene (rule 3). */
    sceneId: text("scene_id").notNull(),
    pos: integer("pos").notNull(),
    rev: revColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.sessionId, t.id] }),
    foreignKey({
      columns: [t.campaignId, t.sessionId],
      foreignColumns: [sessions.campaignId, sessions.id],
      name: "played_scenes_session_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
    foreignKey({
      columns: [t.campaignId, t.sceneId],
      foreignColumns: [scenes.campaignId, scenes.id],
      name: "played_scenes_scene_fk",
    })
      .onUpdate("cascade")
      .onDelete("no action"),
  ],
);

// --- ideas ------------------------------------------------------------------

/**
 * One IDEA the DM threw in on the go. Its text is written once; the one
 * thing that changes later is `done` — the DM ticks an idea off in the
 * review.
 *
 * COLUMNS ONLY, as in `log_entries`: the text and the flag — no headings, no
 * prose and no list markers. `id` is an OPAQUE random string
 * (store/ideas.ts), unique per campaign, the idea's key on the wire. `pos` is
 * the order of creation, one past the highest of the campaign; nothing
 * reorders it. `rev` is the idea's own guard (rule 4).
 */
export const ideas = sqliteTable(
  "ideas",
  {
    campaignId: text("campaign_id").notNull(),
    /** Opaque random id — the idea's identity on the wire. */
    id: text("id").notNull(),
    /** The idea as the DM typed it, hashtags included. */
    text: text("text").notNull().default(""),
    done: integer("done").notNull().default(0),
    pos: integer("pos").notNull(),
    rev: revColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.id] }),
    foreignKey({
      columns: [t.campaignId],
      foreignColumns: [campaigns.id],
      name: "ideas_campaign_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

// --- glossary terms ---------------------------------------------------------

/**
 * One GLOSSARY TERM (ADR #31): a term of the source material and how the
 * campaign says it. The generator quotes the terms to the model as
 * `term → explanation` lines, and the search index holds them.
 *
 * `id` is an OPAQUE random string (store/glossary-terms.ts), unique per
 * campaign — the term's key on the wire, so a term keeps its identity when
 * the DM rewords it. The TERM is unique per campaign as well: a glossary
 * names a term once, and the unique index is what says so. `pos` is the
 * order of creation, one past the highest of the campaign; nothing reorders
 * it. `rev` is the term's own guard (rule 4).
 */
export const glossaryTerms = sqliteTable(
  "glossary_terms",
  {
    campaignId: text("campaign_id").notNull(),
    /** Opaque random id — the term's identity on the wire. */
    id: text("id").notNull(),
    term: text("term").notNull(),
    explanation: text("explanation").notNull().default(""),
    pos: integer("pos").notNull(),
    rev: revColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.id] }),
    uniqueIndex("glossary_terms_term_unique").on(t.campaignId, t.term),
    foreignKey({
      columns: [t.campaignId],
      foreignColumns: [campaigns.id],
      name: "glossary_terms_campaign_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

// --- knowledge items ----------------------------------------------------------

/**
 * One KNOWLEDGE ITEM (ADR #31): a naming convention, fact or style rule the
 * model has to apply even when the source material says something else.
 *
 * Its own table next to `glossary_terms`, per PO decision, because it answers
 * a different question: a glossary term translates a TERM, an item here
 * overrides the source. `kind` decides which columns carry the content
 * (`naming`: `from_text`/`to_text`, otherwise `text`) — the unused ones stay
 * empty strings rather than NULL, so nothing has to distinguish "not set"
 * from "cleared" and a kind switched in the UI keeps what was typed.
 *
 * `id` is an OPAQUE random string (store/knowledge-items.ts), unique per
 * campaign. `pos` is the ORDER of the prompt, which the DM sets: a new item
 * gets one past the highest of the campaign, and
 * `PUT /knowledge-item-order` hands out the positions of all of them, guarded
 * by `campaigns.knowledge_item_order_rev`. `rev` is the item's own guard
 * (rule 4) and does not move when the order does.
 */
export const knowledgeItems = sqliteTable(
  "knowledge_items",
  {
    campaignId: text("campaign_id").notNull(),
    /** Opaque random id — the item's identity on the wire. */
    id: text("id").notNull(),
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
    /** The order of the prompt — see above. */
    pos: integer("pos").notNull(),
    rev: revColumn(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.id] }),
    foreignKey({
      columns: [t.campaignId],
      foreignColumns: [campaigns.id],
      name: "knowledge_items_campaign_fk",
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

// --- generator jobs ---------------------------------------------------------

/**
 * The generate job of a campaign (ADR #10 addendum), at most one per
 * campaign and persisted so it survives a restart. The
 * result/error/edit payloads stay JSON: they are the API's own shapes
 * (`GenerateResult`, `GenerateJobError`, `sceneEdits`) and nothing queries
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
    /** "scene" | "npc" | "scene-augment" | "npc-augment" | "location-augment". */
    kind: text("kind").notNull().default("scene"),
    /**
     * The id of the scene a `scene-augment` run works on; NULL for every
     * other run. Stored from the start of the run, so a job that is still
     * going can already name what it works on. No foreign key: a job is a
     * cache of a run, and deleting the scene leaves a proposal that simply
     * can no longer be accepted.
     */
    sceneId: text("scene_id"),
    /**
     * The id of the npc an `npc-augment` run works on; NULL for every other
     * run. Stored from the start of the run, like `scene_id`. No foreign
     * key: a job is a cache of a run, and deleting the npc leaves a proposal
     * that simply can no longer be accepted.
     */
    npcId: text("npc_id"),
    /**
     * The id of the location a `location-augment` run works on; NULL for
     * every other run. Stored from the start of the run, like `scene_id`.
     * No foreign key: a job is a cache of a run, and deleting the location
     * leaves a proposal that simply can no longer be accepted.
     */
    locationId: text("location_id"),
    /**
     * Target chapter of a scene run; NULL for an npc run. The one reference
     * WITHOUT a foreign key (rule 3): a new-chapter run names the
     * chapter it is going to create, so the chapter exists only once the
     * proposal is accepted.
     */
    chapter: text("chapter"),
    /** "running" | "done" | "failed". Boot turns leftover "running" into "failed". */
    status: text("status").notNull(),
    /** ISO timestamps on the server clock. */
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    result: text("result"),
    npcResult: text("npc_result"),
    /**
     * The augment PROPOSAL — JSON: a `SceneAugmentResult` for a
     * `scene-augment` run, an `NpcAugmentResult` for an `npc-augment` run, a
     * `LocationAugmentResult` for a `location-augment` run.
     */
    augmentResult: text("augment_result"),
    error: text("error"),
    /**
     * The DM's changes to the proposed scenes — JSON, one `SceneChange` per
     * scene id (`GenerateJob.sceneEdits`), applied on top of the proposal
     * when it is accepted.
     */
    sceneEdits: text("scene_edits").notNull().default("{}"),
    /**
     * The DM's changes to the proposed npcs — JSON, one `NpcChange` per npc
     * id (`GenerateJob.npcEdits`), applied on top of the proposal when it is
     * accepted.
     */
    npcEdits: text("npc_edits").notNull().default("{}"),
    /**
     * The DM's REVIEW STATE — JSON, see `GenerateJobReview`:
     * the decision per proposed npc and location, the dropped scenes, the per
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
     * The PIPELINE state of a scene run — JSON: the internal
     * outline, the parts with their per-part status/error/usage, and the
     * run's token and call totals. `{}` for the single-call runs (npc,
     * augment) and for a row written before this deploy, which is what makes
     * the column additive: a job without parts renders exactly as it did.
     */
    pipeline: text("pipeline").notNull().default("{}"),
    /**
     * The run's source material, kept because a per-part RETRY has to send
     * the same excerpt again — and a retry may happen after a
     * restart, when nothing but the row is left. Only a scene run stores it.
     */
    sourceText: text("source_text"),
    /** The run's new-chapter flag — a retry must not 404 on it. */
    newChapter: integer("new_chapter").notNull().default(0),
    /**
     * TITLE of the chapter a new-chapter run creates. It belongs to the
     * run, not to the browser: the review state is persistent, a browser's
     * copy of the start form is not, so a title taken from that copy would be
     * missing after a navigation or a reload — and the chapter with it. It is
     * therefore stored when the run STARTS.
     * NULL for every other run and for a job written before this column
     * existed; the accept then falls back to the chapter id.
     */
    newChapterTitle: text("new_chapter_title"),
  },
  (t) => [uniqueIndex("generate_jobs_campaign_unique").on(t.campaignId)],
);

// --- bookkeeping ------------------------------------------------------------

/**
 * Key/value bookkeeping of the database itself. NOTHING writes a key here;
 * the table is where the next piece of bookkeeping belongs.
 *
 * Keys an older database carries (`migrated_*`, `session_seq:*`) are inert
 * and deliberately not deleted: nothing reads them, a `meta` row costs
 * nothing, and a migration that removes bookkeeping can only fail.
 */
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// --- full-text search -------------------------------------------------------
//
// `search_fts` is an FTS5 virtual table and therefore NOT a drizzle table: it
// is created by the hand-written statement at the end of the baseline
// migration (0000_baseline.sql) and maintained explicitly from the store
// layer.
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

/** Serialize an object for a JSON column (`quickstats`). */
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
  threads,
  scenes,
  sceneNpcs,
  sceneTags,
  npcs,
  locations,
  sessions,
  pauses,
  logEntries,
  playedScenes,
  ideas,
  glossaryTerms,
  knowledgeItems,
  generateJobs,
  meta,
};
