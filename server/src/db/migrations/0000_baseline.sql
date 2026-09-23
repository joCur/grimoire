-- The baseline: the complete schema of Grimoire v0.7, the first supported
-- version (ADR #28). It creates every table, constraint, index and the
-- full-text index in one step.
--
-- Its `when` in meta/_journal.json is the `when` of the last migration v0.7
-- shipped, and it must never change. Drizzle's migrator applies a migration
-- only when its `when` is greater than the `created_at` of the last one the
-- database recorded. A database that has been started with v0.7 therefore
-- skips this baseline, and an empty database gets it.
--
-- Column order is the order a v0.7 database has, so a table here and the same
-- table in a running installation are one shape: columns added to a table
-- later stand at its end.
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`description` text,
	`body` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	`glossary_intro` text DEFAULT '' NOT NULL,
	`glossary_rev` integer DEFAULT 1 NOT NULL,
	`inbox_rev` integer DEFAULT 1 NOT NULL,
	`knowledge_rev` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chapters` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`status` text,
	`body` text DEFAULT '' NOT NULL,
	`pos` integer DEFAULT 0 NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "chapters_status_check" CHECK(`status` is null or `status` in ('planned', 'active', 'done'))
);
--> statement-breakpoint
CREATE TABLE `scenes` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`type` text DEFAULT 'planned' NOT NULL,
	`trigger` text,
	`location` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`handouts` text DEFAULT '[]' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`pos` integer DEFAULT 0 NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`chapter_id`) REFERENCES `chapters`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action,
	FOREIGN KEY (`campaign_id`,`location`) REFERENCES `locations`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action,
	CONSTRAINT "scenes_status_check" CHECK(`status` in ('draft', 'ready', 'played', 'dropped')),
	CONSTRAINT "scenes_type_check" CHECK(`type` in ('planned', 'contingency'))
);
--> statement-breakpoint
CREATE TABLE `scene_npcs` (
	`campaign_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`npc_id` text NOT NULL,
	`pos` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `scene_id`, `npc_id`),
	FOREIGN KEY (`campaign_id`,`scene_id`) REFERENCES `scenes`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`npc_id`) REFERENCES `npcs`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scene_tags` (
	`campaign_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`tag` text NOT NULL,
	`pos` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `scene_id`, `tag`),
	FOREIGN KEY (`campaign_id`,`scene_id`) REFERENCES `scenes`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `npcs` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`role` text,
	`chapter_id` text,
	`status` text DEFAULT 'unknown' NOT NULL,
	`statblock` text,
	`quickstats` text DEFAULT '{}' NOT NULL,
	`voice` text,
	`appearance` text,
	`body` text DEFAULT '' NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`chapter_id`) REFERENCES `chapters`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action,
	CONSTRAINT "npcs_status_check" CHECK(`status` in ('alive', 'dead', 'missing', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`chapter_id` text,
	`roll20_page` text,
	`body` text DEFAULT '' NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`chapter_id`) REFERENCES `chapters`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`started` text,
	`ended` text,
	`body` text DEFAULT '' NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_pauses` (
	`campaign_id` text NOT NULL,
	`session_id` text NOT NULL,
	`pos` integer NOT NULL,
	`from_ts` text NOT NULL,
	`to_ts` text,
	PRIMARY KEY(`campaign_id`, `session_id`, `pos`),
	FOREIGN KEY (`campaign_id`,`session_id`) REFERENCES `sessions`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `log_entries` (
	`campaign_id` text NOT NULL,
	`session_id` text NOT NULL,
	`pos` integer NOT NULL,
	`at` text,
	`scene_id` text,
	`text` text DEFAULT '' NOT NULL,
	`hash` text DEFAULT '' NOT NULL,
	`reviewed` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`campaign_id`, `session_id`, `pos`),
	FOREIGN KEY (`campaign_id`,`session_id`) REFERENCES `sessions`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`scene_id`) REFERENCES `scenes`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `session_scenes_played` (
	`campaign_id` text NOT NULL,
	`session_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`pos` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `session_id`, `pos`),
	FOREIGN KEY (`campaign_id`,`session_id`) REFERENCES `sessions`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`scene_id`) REFERENCES `scenes`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inbox_entries` (
	`campaign_id` text NOT NULL,
	`pos` integer NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`campaign_id`, `pos`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `glossary` (
	`campaign_id` text NOT NULL,
	`term` text NOT NULL,
	`explanation` text DEFAULT '' NOT NULL,
	`pos` integer NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `term`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `campaign_knowledge` (
	`campaign_id` text NOT NULL,
	`pos` integer NOT NULL,
	`kind` text DEFAULT 'fact' NOT NULL,
	`from_text` text DEFAULT '' NOT NULL,
	`to_text` text DEFAULT '' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `pos`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `generate_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`kind` text DEFAULT 'scene' NOT NULL,
	`chapter` text,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`result` text,
	`npc_result` text,
	`error` text,
	`draft_edits` text DEFAULT '{}' NOT NULL,
	`target_path` text,
	`augment_result` text,
	`review` text DEFAULT '{}' NOT NULL,
	`rev` integer DEFAULT 0 NOT NULL,
	`pipeline` text DEFAULT '{}' NOT NULL,
	`source_text` text,
	`new_chapter` integer DEFAULT 0 NOT NULL,
	`new_chapter_title` text,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generate_jobs_campaign_unique` ON `generate_jobs` (`campaign_id`);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
-- The full-text index. Hand-written: FTS5 is a virtual table, drizzle-kit
-- cannot model one, and the snapshot in meta/ does not know it — which is
-- also what keeps a generated diff from ever trying to drop it.
--
-- Column layout and the bm25 weights it implies (see schema.ts, searchRank —
-- `bm25(search_fts, 10, 6, 4, 1)`):
--
--   title  (10) the entry's display name — a hit here is what the DM meant
--   ref     (6) the id — typed by anyone who knows the reference
--   tags    (4) authored keywords
--   body    (1) the markdown text; a hit here is context, not identity
--
-- `campaign_id`, `kind` and `entity_id` are UNINDEXED: they are filter and
-- payload columns (the search endpoint answers `SearchResult.kind`/`id`/
-- `path` from them), and indexing them would let a query match on a campaign
-- name or the word "scene".
--
-- Tokenizer `unicode61 remove_diacritics 2`: the data is German, and level 2
-- also folds diacritics on codepoints outside Latin-1. This is what makes
-- "muller" find "Müller" and "leuchtturm" find "Leuchtturm".
--
-- A plain FTS5 table that owns its copy of the text, maintained EXPLICITLY
-- from the store layer. No triggers: the rows it indexes come from several
-- tables with different notions of "title", and a trigger per table would put
-- that mapping in SQL where nothing can test it.
CREATE VIRTUAL TABLE `search_fts` USING fts5(
	title,
	ref,
	tags,
	body,
	campaign_id UNINDEXED,
	kind UNINDEXED,
	entity_id UNINDEXED,
	tokenize = 'unicode61 remove_diacritics 2'
);
