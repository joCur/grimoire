-- ADR #18, second half: EVERY reference becomes a real foreign key, and
-- `scenes.chapter_id` becomes NOT NULL.
--
-- The columns this adds a constraint to:
--
--   scenes.chapter_id              -> chapters   (NOT NULL now)
--   scenes.location                -> locations  (nullable)
--   scene_npcs.npc_id              -> npcs
--   npc_relations.other_npc_id     -> npcs
--   npcs.chapter_id                -> chapters   (nullable)
--   locations.chapter_id           -> chapters   (nullable)
--   log_entries.scene_id           -> scenes     (nullable)
--   session_scenes_played.scene_id -> scenes
--
-- All of them ON UPDATE CASCADE (an id IS the key, schema rule 5) and none of
-- them with a delete action: a delete that would orphan authored data is
-- refused, and `SET NULL` is never the answer because it hides the loss. The
-- two delete cascades that already existed stay — a join row dies with its
-- PARENT (`scene_npcs` with its scene, `npc_relations` with the npc the line
-- stands under), never with the entity it points at.
--
-- The rows this would fail on are gone by the time it runs: the pre-migration
-- repair of db/reference-repair.ts closes every hole on the raw client,
-- BEFORE the migrator opens its transaction — a scene without a chapter gets
-- one, a reference that names nothing gets its empty entry.
--
-- HAND-EDITED, for the two reasons migration 0014 already carries at its
-- head, and they now apply to three tables instead of one:
--
--   * `PRAGMA foreign_keys=OFF/ON`, which drizzle-kit brackets each rebuild
--     with, is a documented NO-OP inside a transaction — and db/client.ts
--     runs the whole migration in one. The pragma lines are therefore
--     removed rather than left as decoration.
--   * with enforcement still on, `DROP TABLE <parent>` performs an implicit
--     `DELETE FROM`, which CASCADES into the children that die with it. So
--     every child row is set aside in a plain table and put back in the same
--     transaction: `npc_relations` around the `npcs` rebuild, `scene_npcs`
--     and `scene_tags` around the `scenes` one. Either the whole migration
--     commits or none of it does.
--
-- THE ORDER IS PART OF THE MIGRATION. A table is rebuilt BEFORE it becomes
-- the target of a restricting reference: `npcs` and `locations` first (while
-- nothing points at them yet), then `scenes`, then the four tables that
-- receive the new constraints. Rebuilding `scenes` after `log_entries` had
-- its scene reference would make the implicit delete of the rebuild fail
-- against exactly the constraint this migration installs.
--
-- The children's foreign keys name their parent by NAME, so dropping the old
-- table does not rewrite them and the rename into that name makes them
-- resolve to the new one — the table they were always about.

-- 1. npcs: the optional chapter reference. `npc_relations` dies with an
--    npc, so its rows are set aside across the rebuild.
CREATE TABLE `__keep_npc_relations` AS SELECT * FROM `npc_relations`;--> statement-breakpoint
CREATE TABLE `__new_npcs` (
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
	`extra` text DEFAULT '{}' NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`chapter_id`) REFERENCES `chapters`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_npcs`("campaign_id", "id", "name", "role", "chapter_id", "status", "statblock", "quickstats", "voice", "appearance", "body", "extra", "rev") SELECT "campaign_id", "id", "name", "role", "chapter_id", "status", "statblock", "quickstats", "voice", "appearance", "body", "extra", "rev" FROM `npcs`;--> statement-breakpoint
DROP TABLE `npcs`;--> statement-breakpoint
ALTER TABLE `__new_npcs` RENAME TO `npcs`;--> statement-breakpoint
INSERT INTO `npc_relations` SELECT * FROM `__keep_npc_relations`;--> statement-breakpoint
DROP TABLE `__keep_npc_relations`;--> statement-breakpoint
-- 2. locations: the same optional chapter reference. Nothing points at
--    this table yet — `scenes.location` gets its constraint in step 3.
CREATE TABLE `__new_locations` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`chapter_id` text,
	`roll20_page` text,
	`body` text DEFAULT '' NOT NULL,
	`extra` text DEFAULT '{}' NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`chapter_id`) REFERENCES `chapters`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_locations`("campaign_id", "id", "name", "chapter_id", "roll20_page", "body", "extra", "rev") SELECT "campaign_id", "id", "name", "chapter_id", "roll20_page", "body", "extra", "rev" FROM `locations`;--> statement-breakpoint
DROP TABLE `locations`;--> statement-breakpoint
ALTER TABLE `__new_locations` RENAME TO `locations`;--> statement-breakpoint
-- 3. scenes: `chapter_id` NOT NULL, plus the location reference. Both
--    scene child tables cascade, so both are set aside.
CREATE TABLE `__keep_scene_npcs` AS SELECT * FROM `scene_npcs`;--> statement-breakpoint
CREATE TABLE `__keep_scene_tags` AS SELECT * FROM `scene_tags`;--> statement-breakpoint
CREATE TABLE `__new_scenes` (
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
	`extra` text DEFAULT '{}' NOT NULL,
	`pos` integer DEFAULT 0 NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`chapter_id`) REFERENCES `chapters`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action,
	FOREIGN KEY (`campaign_id`,`location`) REFERENCES `locations`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_scenes`("campaign_id", "id", "chapter_id", "title", "type", "trigger", "location", "status", "handouts", "body", "extra", "pos", "rev") SELECT "campaign_id", "id", "chapter_id", "title", "type", "trigger", "location", "status", "handouts", "body", "extra", "pos", "rev" FROM `scenes`;--> statement-breakpoint
DROP TABLE `scenes`;--> statement-breakpoint
ALTER TABLE `__new_scenes` RENAME TO `scenes`;--> statement-breakpoint
INSERT INTO `scene_npcs` SELECT * FROM `__keep_scene_npcs`;--> statement-breakpoint
INSERT INTO `scene_tags` SELECT * FROM `__keep_scene_tags`;--> statement-breakpoint
DROP TABLE `__keep_scene_npcs`;--> statement-breakpoint
DROP TABLE `__keep_scene_tags`;--> statement-breakpoint
-- 4. the four reference tables. Each one only RECEIVES a constraint, so
--    nothing cascades into them and no rows have to be set aside.
CREATE TABLE `__new_scene_npcs` (
	`campaign_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`npc_id` text NOT NULL,
	`pos` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `scene_id`, `npc_id`),
	FOREIGN KEY (`campaign_id`,`scene_id`) REFERENCES `scenes`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`npc_id`) REFERENCES `npcs`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_scene_npcs`("campaign_id", "scene_id", "npc_id", "pos") SELECT "campaign_id", "scene_id", "npc_id", "pos" FROM `scene_npcs`;--> statement-breakpoint
DROP TABLE `scene_npcs`;--> statement-breakpoint
ALTER TABLE `__new_scene_npcs` RENAME TO `scene_npcs`;--> statement-breakpoint
CREATE TABLE `__new_npc_relations` (
	`campaign_id` text NOT NULL,
	`npc_id` text NOT NULL,
	`other_npc_id` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`pos` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `npc_id`, `other_npc_id`),
	FOREIGN KEY (`campaign_id`,`npc_id`) REFERENCES `npcs`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`other_npc_id`) REFERENCES `npcs`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_npc_relations`("campaign_id", "npc_id", "other_npc_id", "note", "pos") SELECT "campaign_id", "npc_id", "other_npc_id", "note", "pos" FROM `npc_relations`;--> statement-breakpoint
DROP TABLE `npc_relations`;--> statement-breakpoint
ALTER TABLE `__new_npc_relations` RENAME TO `npc_relations`;--> statement-breakpoint
CREATE TABLE `__new_log_entries` (
	`campaign_id` text NOT NULL,
	`session_id` text NOT NULL,
	`pos` integer NOT NULL,
	`raw` text NOT NULL,
	`at` text,
	`scene_id` text,
	`text` text,
	`hash` text DEFAULT '' NOT NULL,
	`reviewed` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`campaign_id`, `session_id`, `pos`),
	FOREIGN KEY (`campaign_id`,`session_id`) REFERENCES `sessions`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`scene_id`) REFERENCES `scenes`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_log_entries`("campaign_id", "session_id", "pos", "raw", "at", "scene_id", "text", "hash", "reviewed") SELECT "campaign_id", "session_id", "pos", "raw", "at", "scene_id", "text", "hash", "reviewed" FROM `log_entries`;--> statement-breakpoint
DROP TABLE `log_entries`;--> statement-breakpoint
ALTER TABLE `__new_log_entries` RENAME TO `log_entries`;--> statement-breakpoint
CREATE TABLE `__new_session_scenes_played` (
	`campaign_id` text NOT NULL,
	`session_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`pos` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `session_id`, `pos`),
	FOREIGN KEY (`campaign_id`,`session_id`) REFERENCES `sessions`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`scene_id`) REFERENCES `scenes`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_session_scenes_played`("campaign_id", "session_id", "scene_id", "pos") SELECT "campaign_id", "session_id", "scene_id", "pos" FROM `session_scenes_played`;--> statement-breakpoint
DROP TABLE `session_scenes_played`;--> statement-breakpoint
ALTER TABLE `__new_session_scenes_played` RENAME TO `session_scenes_played`;