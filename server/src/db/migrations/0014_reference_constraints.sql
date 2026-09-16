--> Every reference becomes a real foreign key, and a scene's chapter becomes
--> mandatory. SQLite cannot add a constraint to an existing table, so the
--> seven affected tables are REBUILT — the documented procedure: create the
--> new table, carry the rows over, drop the old one, rename.
-->
--> Two things the generated form of that procedure cannot do, and they are
--> why this file is hand-written:
-->
--> 1. CHILD ROWS. The migrator runs inside a transaction, where
-->    `PRAGMA foreign_keys` is ignored, so dropping `scenes` takes every
-->    `scene_npcs` and `scene_tags` row with it (their cascade fires) and
-->    dropping `locations` would be refused while a scene names one. So all
-->    affected rows are set aside in `__mig0014_*` tables first, every table
-->    involved is rebuilt EMPTY, and the rows are put back parent before
-->    child — where the new constraints check them.
--> 2. THE ORDER of the refill is what proves the data: `scenes` can only be
-->    refilled once `chapters` and `locations` hold what it references.
-->
--> The data has already been checked at this point (db/reference-preflight.ts
--> runs before the migrator and aborts the start when a reference names
--> nothing), so a constraint that fires here is a bug, not a data problem.
-->
--> `npc_relations` is dropped with no replacement: an npc's `## Beziehungen`
--> is prose in the npc's text, and nothing in the storage is derived from
--> body text any more.
DROP TABLE `npc_relations`;--> statement-breakpoint
CREATE TABLE `__mig0014_scenes` AS SELECT * FROM `scenes`;--> statement-breakpoint
CREATE TABLE `__mig0014_locations` AS SELECT * FROM `locations`;--> statement-breakpoint
CREATE TABLE `__mig0014_npcs` AS SELECT * FROM `npcs`;--> statement-breakpoint
CREATE TABLE `__mig0014_scene_npcs` AS SELECT * FROM `scene_npcs`;--> statement-breakpoint
CREATE TABLE `__mig0014_scene_tags` AS SELECT * FROM `scene_tags`;--> statement-breakpoint
CREATE TABLE `__mig0014_log_entries` AS SELECT * FROM `log_entries`;--> statement-breakpoint
CREATE TABLE `__mig0014_session_scenes_played` AS SELECT * FROM `session_scenes_played`;--> statement-breakpoint
DELETE FROM `scene_npcs`;--> statement-breakpoint
DELETE FROM `scene_tags`;--> statement-breakpoint
DELETE FROM `log_entries`;--> statement-breakpoint
DELETE FROM `session_scenes_played`;--> statement-breakpoint
DELETE FROM `scenes`;--> statement-breakpoint
DELETE FROM `locations`;--> statement-breakpoint
DELETE FROM `npcs`;--> statement-breakpoint
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
DROP TABLE `locations`;--> statement-breakpoint
ALTER TABLE `__new_locations` RENAME TO `locations`;--> statement-breakpoint
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
DROP TABLE `npcs`;--> statement-breakpoint
ALTER TABLE `__new_npcs` RENAME TO `npcs`;--> statement-breakpoint
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
DROP TABLE `scenes`;--> statement-breakpoint
ALTER TABLE `__new_scenes` RENAME TO `scenes`;--> statement-breakpoint
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
DROP TABLE `scene_npcs`;--> statement-breakpoint
ALTER TABLE `__new_scene_npcs` RENAME TO `scene_npcs`;--> statement-breakpoint
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
DROP TABLE `session_scenes_played`;--> statement-breakpoint
ALTER TABLE `__new_session_scenes_played` RENAME TO `session_scenes_played`;--> statement-breakpoint
INSERT INTO `locations`("campaign_id", "id", "name", "chapter_id", "roll20_page", "body", "extra", "rev") SELECT "campaign_id", "id", "name", "chapter_id", "roll20_page", "body", "extra", "rev" FROM `__mig0014_locations`;--> statement-breakpoint
INSERT INTO `npcs`("campaign_id", "id", "name", "role", "chapter_id", "status", "statblock", "quickstats", "voice", "appearance", "body", "extra", "rev") SELECT "campaign_id", "id", "name", "role", "chapter_id", "status", "statblock", "quickstats", "voice", "appearance", "body", "extra", "rev" FROM `__mig0014_npcs`;--> statement-breakpoint
INSERT INTO `scenes`("campaign_id", "id", "chapter_id", "title", "type", "trigger", "location", "status", "handouts", "body", "extra", "pos", "rev") SELECT "campaign_id", "id", "chapter_id", "title", "type", "trigger", "location", "status", "handouts", "body", "extra", "pos", "rev" FROM `__mig0014_scenes`;--> statement-breakpoint
INSERT INTO `scene_npcs`("campaign_id", "scene_id", "npc_id", "pos") SELECT "campaign_id", "scene_id", "npc_id", "pos" FROM `__mig0014_scene_npcs`;--> statement-breakpoint
INSERT INTO `scene_tags`("campaign_id", "scene_id", "tag", "pos") SELECT "campaign_id", "scene_id", "tag", "pos" FROM `__mig0014_scene_tags`;--> statement-breakpoint
INSERT INTO `log_entries`("campaign_id", "session_id", "pos", "raw", "at", "scene_id", "text", "hash", "reviewed") SELECT "campaign_id", "session_id", "pos", "raw", "at", "scene_id", "text", "hash", "reviewed" FROM `__mig0014_log_entries`;--> statement-breakpoint
INSERT INTO `session_scenes_played`("campaign_id", "session_id", "scene_id", "pos") SELECT "campaign_id", "session_id", "scene_id", "pos" FROM `__mig0014_session_scenes_played`;--> statement-breakpoint
DROP TABLE `__mig0014_scenes`;--> statement-breakpoint
DROP TABLE `__mig0014_locations`;--> statement-breakpoint
DROP TABLE `__mig0014_npcs`;--> statement-breakpoint
DROP TABLE `__mig0014_scene_npcs`;--> statement-breakpoint
DROP TABLE `__mig0014_scene_tags`;--> statement-breakpoint
DROP TABLE `__mig0014_log_entries`;--> statement-breakpoint
DROP TABLE `__mig0014_session_scenes_played`;
