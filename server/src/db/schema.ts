// The Grimoire database schema — the ONE place the storage shape is written
// down in code.
//
// Design rules, binding for every table added later:
//
//   1. CONTRACT FIELDS ARE COLUMNS, and there is nothing beside them.
//      Everything README.md names for an entity gets its own column; a key
//      the contract does not name has no field behind it and is refused
//      (the entry PATCH answers 400, and so does a seed). The contract
//      lists live once, in store/properties.ts `PROPERTY_CONTRACT`.
//   2. REFERENCES ARE TABLES with a `pos` column. `npcs: [jorna, fenn]` is an
//      ORDERED list, and the order is authored information.
//   3. EVERY REFERENCE IS A FOREIGN KEY. A scene's chapter and location, the
//      npcs of a scene, the chapter of an npc and of a location, the scene
//      of a log line and of a played-scenes entry each carry a composite
//      `(campaign_id, <ref>)` foreign key with
//      `ON UPDATE CASCADE` (rule 5) and `ON DELETE NO ACTION`. So a stored
//      reference names an entry that EXISTS, and the database is what
//      guarantees it. Nullable where the reference may be absent;
//      `scenes.chapter_id` is NOT NULL, because a scene belongs to a
//      chapter.
//      TWO CONSEQUENCES, and they are the point. A write that names an
//      entry which does not exist is refused (400) instead of storing a
//      hole, and NOTHING creates an entry because something mentioned it.
//      The creation paths are: the create endpoints, „NPC-Stub anlegen" from
//      a review line, accepting a generator proposal — and, inside that
//      accept, the chapter a „Neues Kapitel" run decided on. Nowhere else.
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
import {
  CHAPTER_STATUSES,
  NPC_STATUSES,
  SCENE_STATUSES,
  SCENE_TYPES,
} from "@grimoire/shared/types";

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
  /** Free note space — the campaign entry's markdown body. */
  body: text("body").notNull().default(""),
  /** Bumped on every write; the app polls it to invalidate its queries. */
  version: integer("version").notNull().default(1),
  rev: revColumn(),
  /**
   * The glossary's PROSE PREAMBLE — text above the first term that belongs
   * to no term. It has no row of its own, so it lives here and is rendered
   * back in front of the term list. Nothing writes it any more (the glossary
   * is edited as a list, ADR #23); what an older instance stored is still
   * shown. Empty for the usual glossary.
   */
  glossaryIntro: text("glossary_intro").notNull().default(""),
  /**
   * Guard tokens of the two LIST entries, glossary and inbox. Neither is a
   * single row that could carry a `rev`, and `version` — which every
   * unrelated write bumps — would make an open glossary edit unsaveable
   * during a running session. These count only their own list's writes, so
   * they behave exactly like an entity's `rev`.
   */
  glossaryRev: integer("glossary_rev").notNull().default(1),
  inboxRev: integer("inbox_rev").notNull().default(1),
  /**
   * Guard token of the CAMPAIGN KNOWLEDGE list. Third of the same
   * kind as the two above and for the same reason: `campaign_knowledge` is a
   * whole list, so the version belongs to the LIST and not to a row
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
     * Its own counter, for the reason the three list guards on `campaigns`
     * have theirs: the order is a list that lives on its own, and `rev` —
     * which every unrelated write of the chapter bumps — would make an open
     * chapter-text edit unsaveable the moment somebody rearranges the scenes.
     * The other direction holds too, which is the one that bites: reordering
     * must not 409 an editor it has nothing to do with. So the order counts
     * only its own writes, and `rev` counts only the entry's.
     */
    sceneOrderRev: integer("scene_order_rev").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.id] }),
    check("chapters_status_check", oneOf("status", CHAPTER_STATUSES, true)),
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
     * to a chapter: the chapter is part of the scene's address, so a scene
     * without one has nowhere to be read.
     */
    chapterId: text("chapter_id").notNull(),
    title: text("title").notNull().default(""),
    /** `planned | contingency` (shared `SCENE_TYPES`), held by a CHECK. */
    type: text("type").notNull().default("planned"),
    /** Free-text firing condition — only meaningful for contingency scenes. */
    trigger: text("trigger"),
    /**
     * The scene's location — a foreign key to an existing location entry, or
     * null when the scene sits at chapter level. Never free text.
     *
     * It is part of the scene's ADDRESS — `<chapter>/<location>/<id>` is
     * derived from this column, which is why there is no independent
     * group column (ADR #17). It does not order
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
     * its scenes by it, with the id as the tie-break.
     *
     * It is SET, never derived: creating a scene appends it to its chapter,
     * moving one to another chapter appends it there, and
     * `PUT /chapters/:chapter/scene-order` hands out the whole chapter's
     * positions from the order the DM dragged them into. Nothing reads an
     * ordering out of the title, the address or the location any more.
     *
     * It is not a property either (store/properties.ts `SCENE_KEYS`): the
     * position of a scene among its siblings is a statement about the
     * chapter, so it is written where the chapter is guarded, not in the
     * scene's own properties dialog.
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
 * One game session. `started`/`ended` keep the zone-less wall-clock strings
 * of the README's writing rules; the epoch reading stays the server's job.
 * An `ended` that is NULL or blank means the session runs (session-state.ts).
 *
 * IDENTITY (PO decision): the id of a NEW session is an OPAQUE
 * RANDOM string — `crypto.randomUUID()` (store/sessions.ts `newSessionId`).
 * Nobody reads it: it is an address (`sessions/<id>`) and nothing else,
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
 * They are simply not parsed.
 *
 * ORDER is `started` alone (store/shared.ts `compareSessionsNewestFirst`), with
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
     * `started`, which is only second-precise. Start, end and start again
     * inside one second gives two rows the same `started`, and "the most
     * recently started" has to be the second of them deterministically. The
     * opaque id cannot answer that (it has no time in it), so the row records
     * when it was written.
     *
     * NOT a wall-clock string like `started`: this is bookkeeping of the
     * database, never entry content, and an entry has no property for it.
     * It is also STRICTLY INCREASING per campaign rather than a plain
     * `Date.now()` (store/sessions.ts `nextCreatedAt`) — a clock that stands
     * still or jumps back must not make two rows unorderable.
     *
     * `0` for rows written before the column existed and for the markdown
     * import — they then fall back to the id compare, which only ever decides
     * between sessions that already share a `started`.
     */
    createdAt: integer("created_at").notNull().default(0),
    /**
     * Everything in the session's text that is not `## Log` — `## Threads`
     * above all. Kept as one markdown field so no hand-written section is
     * lost.
     */
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
 * One pause interval of a session, second-precise and zone-less like
 * `started`/`ended`. `toTs` NULL is the RUNNING pause (README).
 * `pos` is the position in the session's pause list and therefore the key —
 * two pauses may legitimately share a `from`.
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
 * One line of a session's log. APPEND-ONLY stays the rule; `pos` is the
 * append counter and the key.
 *
 * COLUMNS ONLY: the row holds the note's time, the scene it was taken in, its
 * text and the review flag. There is no markdown line beside them — the log
 * is a table the API answers as rows (ADR #26), and a row that carried both a
 * line and its parse had two truths about one note.
 *
 * `hash` is the row's stable ID, the short hash of its canonical line
 * (store/body-parse.ts). The review names a line by it, and `reviewed` is a
 * plain flag on the row rather than a hash list beside the session.
 */
export const logEntries = sqliteTable(
  "log_entries",
  {
    campaignId: text("campaign_id").notNull(),
    sessionId: text("session_id").notNull(),
    pos: integer("pos").notNull(),
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
    /** The row's stable id — see the note above. */
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
    /** The scene — a foreign key to an existing entry (rule 3). */
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
    foreignKey({
      columns: [t.campaignId, t.sceneId],
      foreignColumns: [scenes.campaignId, scenes.id],
      name: "session_scenes_played_scene_fk",
    })
      .onUpdate("cascade")
      .onDelete("no action"),
  ],
);

// --- inbox ------------------------------------------------------------------

/**
 * One idea in the campaign inbox. Append-only with one exception, the `done`
 * flag — the DM ticks an idea off in the review and nothing else rewrites a
 * row.
 *
 * COLUMNS ONLY, as in `log_entries`: the text and the flag. The inbox is a
 * table the API answers as rows (ADR #26), so it holds no headings, no prose
 * and no list markers — those were the skeleton of a text that no longer
 * exists.
 */
export const inboxEntries = sqliteTable(
  "inbox_entries",
  {
    campaignId: text("campaign_id").notNull(),
    /** The append counter, the key — and the row's id on the wire. */
    pos: integer("pos").notNull(),
    /** The idea as the DM typed it, hashtags included. */
    text: text("text").notNull().default(""),
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
 * The translation glossary as a STRUCTURED table: term → explanation
 * instead of one markdown blob. The generator's
 * knowledge base builds on exactly this table.
 */
export const glossary = sqliteTable(
  "glossary",
  {
    campaignId: text("campaign_id").notNull(),
    term: text("term").notNull(),
    explanation: text("explanation").notNull().default(""),
    /** Stable display order — the order the terms were written in. */
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
 * The campaign's KNOWLEDGE BASE for the generator: naming
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
 * The generate job of a campaign (ADR #10 addendum). Still at most one
 * per campaign; persisting it is what slice 4 switches on. The
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
    /** "scene" | "npc" | "augment". */
    kind: text("kind").notNull().default("scene"),
    /**
     * Address of the entry an `augment` run targets; NULL for the
     * two runs that CREATE something. Stored from the start of the run, so a
     * job that is still going can already name the entry it works on.
     */
    targetPath: text("target_path"),
    /**
     * Target chapter of a scene run; NULL for an npc run. The one reference
     * WITHOUT a foreign key (rule 3): a run with „Neues Kapitel" names the
     * chapter it is going to create, so the entry exists only once the
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
    /** The augment PROPOSAL — JSON, see AugmentResult. */
    augmentResult: text("augment_result"),
    error: text("error"),
    draftEdits: text("draft_edits").notNull().default("{}"),
    /**
     * The DM's REVIEW STATE — JSON, see `GenerateJobReview`:
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
    /** The run's „Neues Kapitel" flag — a retry must not 404 on it. */
    newChapter: integer("new_chapter").notNull().default(0),
    /**
     * TITLE of the chapter a „Neues Kapitel" run creates. It belongs to the
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
 * Key/value bookkeeping of the database itself. NOTHING writes a key here at
 * the moment; the table stays because it is where the next piece of
 * bookkeeping belongs and because old databases carry keys in it.
 *
 * Those old keys are inert and deliberately not deleted: the `migrated_*`
 * markers of the one-time markdown migration, and `session_seq:<campaign>:
 * <date>` from the time session ids were date+sequence (with opaque random
 * ids — see `sessions` — nothing has to be reserved any more). A `meta` row
 * costs nothing, and a migration that removes bookkeeping can only fail.
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
  scenes,
  sceneNpcs,
  sceneTags,
  npcs,
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
