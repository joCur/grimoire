--> `scenes.status`, `scenes.type`, `npcs.status` and `chapters.status` become
--> CHECK constraints (ADR #25). SQLite cannot add a constraint to an existing
--> table, so the three tables are REBUILT — create the new table, carry the
--> rows over, drop the old one, rename.
-->
--> The generated form of that procedure cannot be used as it stands, for the
--> same reason migration 0014 is hand-written: the migrator runs inside a
--> TRANSACTION, where `PRAGMA foreign_keys` is ignored. So the
--> `PRAGMA foreign_keys=OFF` a generated rebuild opens with does nothing, and
--> two things follow from that.
-->
--> 1. DROPPING A PARENT IS REFUSED while a child row names it. `scenes`,
-->    `npcs` and `locations` all reference `chapters` with ON DELETE NO
-->    ACTION, and `scene_npcs` references `npcs`.
--> 2. DROPPING `scenes` DELETES CHILD ROWS. `scene_npcs` and `scene_tags`
-->    cascade, so their rows would go with the old table — in silence.
-->
--> Hence the 0014 procedure: every affected row is set aside in a
--> `__mig0016_*` table first, the tables are emptied CHILD BEFORE PARENT, the
--> three tables are rebuilt while nothing references a row, and the rows go
--> back PARENT BEFORE CHILD — where the new constraints check them.
--> `locations` is emptied and refilled without being rebuilt: it holds no
--> constrained column, but its `chapter_id` would block the `chapters` drop.
-->
--> The data has already been checked at this point (db/reference-preflight.ts
--> runs before the migrator and aborts the start when a status or type is
--> outside its list), so a CHECK that fires here is a bug, not a data problem.
-->
--> `rev` is deliberately NOT bumped: no value changes, so an editor that is
--> open keeps its guard token.
CREATE TABLE `__mig0016_chapters` AS SELECT * FROM `chapters`;--> statement-breakpoint
CREATE TABLE `__mig0016_locations` AS SELECT * FROM `locations`;--> statement-breakpoint
CREATE TABLE `__mig0016_npcs` AS SELECT * FROM `npcs`;--> statement-breakpoint
CREATE TABLE `__mig0016_scenes` AS SELECT * FROM `scenes`;--> statement-breakpoint
CREATE TABLE `__mig0016_scene_npcs` AS SELECT * FROM `scene_npcs`;--> statement-breakpoint
CREATE TABLE `__mig0016_scene_tags` AS SELECT * FROM `scene_tags`;--> statement-breakpoint
CREATE TABLE `__mig0016_log_entries` AS SELECT * FROM `log_entries`;--> statement-breakpoint
CREATE TABLE `__mig0016_session_scenes_played` AS SELECT * FROM `session_scenes_played`;--> statement-breakpoint
DELETE FROM `scene_npcs`;--> statement-breakpoint
DELETE FROM `scene_tags`;--> statement-breakpoint
DELETE FROM `log_entries`;--> statement-breakpoint
DELETE FROM `session_scenes_played`;--> statement-breakpoint
DELETE FROM `scenes`;--> statement-breakpoint
DELETE FROM `locations`;--> statement-breakpoint
DELETE FROM `npcs`;--> statement-breakpoint
DELETE FROM `chapters`;--> statement-breakpoint
CREATE TABLE `__new_chapters` (
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
DROP TABLE `chapters`;--> statement-breakpoint
ALTER TABLE `__new_chapters` RENAME TO `chapters`;--> statement-breakpoint
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
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`chapter_id`) REFERENCES `chapters`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action,
	CONSTRAINT "npcs_status_check" CHECK(`status` in ('alive', 'dead', 'missing', 'unknown'))
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
DROP TABLE `scenes`;--> statement-breakpoint
ALTER TABLE `__new_scenes` RENAME TO `scenes`;--> statement-breakpoint
INSERT INTO `chapters`("campaign_id", "id", "title", "status", "body", "pos", "rev") SELECT "campaign_id", "id", "title", "status", "body", "pos", "rev" FROM `__mig0016_chapters`;--> statement-breakpoint
INSERT INTO `locations`("campaign_id", "id", "name", "chapter_id", "roll20_page", "body", "rev") SELECT "campaign_id", "id", "name", "chapter_id", "roll20_page", "body", "rev" FROM `__mig0016_locations`;--> statement-breakpoint
INSERT INTO `npcs`("campaign_id", "id", "name", "role", "chapter_id", "status", "statblock", "quickstats", "voice", "appearance", "body", "rev") SELECT "campaign_id", "id", "name", "role", "chapter_id", "status", "statblock", "quickstats", "voice", "appearance", "body", "rev" FROM `__mig0016_npcs`;--> statement-breakpoint
INSERT INTO `scenes`("campaign_id", "id", "chapter_id", "title", "type", "trigger", "location", "status", "handouts", "body", "pos", "rev") SELECT "campaign_id", "id", "chapter_id", "title", "type", "trigger", "location", "status", "handouts", "body", "pos", "rev" FROM `__mig0016_scenes`;--> statement-breakpoint
INSERT INTO `scene_npcs`("campaign_id", "scene_id", "npc_id", "pos") SELECT "campaign_id", "scene_id", "npc_id", "pos" FROM `__mig0016_scene_npcs`;--> statement-breakpoint
INSERT INTO `scene_tags`("campaign_id", "scene_id", "tag", "pos") SELECT "campaign_id", "scene_id", "tag", "pos" FROM `__mig0016_scene_tags`;--> statement-breakpoint
INSERT INTO `log_entries`("campaign_id", "session_id", "pos", "raw", "at", "scene_id", "text", "hash", "reviewed") SELECT "campaign_id", "session_id", "pos", "raw", "at", "scene_id", "text", "hash", "reviewed" FROM `__mig0016_log_entries`;--> statement-breakpoint
INSERT INTO `session_scenes_played`("campaign_id", "session_id", "scene_id", "pos") SELECT "campaign_id", "session_id", "scene_id", "pos" FROM `__mig0016_session_scenes_played`;--> statement-breakpoint
DROP TABLE `__mig0016_chapters`;--> statement-breakpoint
DROP TABLE `__mig0016_locations`;--> statement-breakpoint
DROP TABLE `__mig0016_npcs`;--> statement-breakpoint
DROP TABLE `__mig0016_scenes`;--> statement-breakpoint
DROP TABLE `__mig0016_scene_npcs`;--> statement-breakpoint
DROP TABLE `__mig0016_scene_tags`;--> statement-breakpoint
DROP TABLE `__mig0016_log_entries`;--> statement-breakpoint
DROP TABLE `__mig0016_session_scenes_played`;
