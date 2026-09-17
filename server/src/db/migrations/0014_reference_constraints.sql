--> Every reference becomes a real foreign key, and a scene's chapter becomes
--> mandatory. SQLite cannot add a constraint to an existing table, so the
--> seven affected tables are REBUILT — the documented procedure: create the
--> new table, carry the rows over, drop the old one, rename.
-->
--> TAKE A BACKUP BEFORE THE START THAT RUNS THIS. It is the first migration
--> that rewrites campaign CONTENT (the relation notes below), and there is no
--> downgrade — docs/DEPLOYMENT.md has the two consistent ways.
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
--> `npc_relations` is dropped: an npc's `## Beziehungen` is prose in the
--> npc's text, and nothing in the storage is derived from body text any
--> more. THE NOTES ARE KEPT. They only ever existed as rows — the importer
--> took the lines out of the text and the read path rendered them back — so
--> before the table goes, every npc that has rows gets the section written
--> into its own text, character for character as the reader produced it:
--> the heading, a blank line, then one `- <id>: <note>` line per row in
--> `pos` order (`- <id>:` for an empty note). A text that already carries a
--> `## Beziehungen` heading gets the lines under THAT heading, the way the
--> reader put them there; every other text gets the section appended, which
--> is where the reader appended it. Values in `[[…]]` keep their brackets:
--> they are prose now, and prose is copied, not interpreted.
-->
--> The heading recognised here is the CANONICAL one and only that — two
--> hashes, one space, the word, then nothing but blanks. Any other spelling
--> would place the section somewhere else than the reader did, so the
--> pre-flight refuses the start for it by npc id (db/reference-preflight.ts)
--> rather than this file guessing at what a heading was meant to be.
-->
--> `rev` is deliberately NOT bumped: what `GET /entry` answers is the same
--> text as before, so an editor that is open keeps its guard token.
-->
--> The line order comes from `ORDER BY` inside `group_concat`, which needs
--> SQLite 3.44 or newer — both backends ship far newer, and an older one
--> fails the migration with a syntax error instead of reordering a DM's
--> notes silently.
CREATE TABLE `__mig0014_relation_bodies` AS
	WITH `lines` AS (
		SELECT
			`campaign_id`,
			`npc_id`,
			group_concat(
				'- ' || `other_npc_id` || CASE WHEN `note` = '' THEN ':' ELSE ': ' || `note` END,
				char(10) ORDER BY `pos`
			) AS `text`
		FROM `npc_relations`
		GROUP BY `campaign_id`, `npc_id`
	),
	`found` AS (
		SELECT
			n.`campaign_id` AS `campaign_id`,
			n.`id` AS `npc_id`,
			n.`body` AS `body`,
			l.`text` AS `lines`,
			CASE
				WHEN substr(lower(n.`body`), 1, 14) = '## beziehungen' THEN 1
				WHEN instr(lower(n.`body`), char(10) || '## beziehungen') > 0
					THEN instr(lower(n.`body`), char(10) || '## beziehungen') + 1
				ELSE 0
			END AS `start`
		FROM `npcs` AS n
		JOIN `lines` AS l ON l.`campaign_id` = n.`campaign_id` AND l.`npc_id` = n.`id`
	),
	`placed` AS (
		SELECT
			`campaign_id`,
			`npc_id`,
			`body`,
			`lines`,
			`start`,
			CASE
				WHEN `start` = 0 THEN 0
				WHEN instr(substr(`body`, `start`), char(10)) = 0 THEN length(`body`)
				ELSE `start` + instr(substr(`body`, `start`), char(10)) - 2
			END AS `end`
		FROM `found`
	)
	SELECT
		`campaign_id`,
		`npc_id`,
		CASE
			-- The heading is only a heading when nothing but blanks follows it
			-- on its line, which is what the reader's own pattern asked for.
			WHEN `start` > 0
				AND rtrim(substr(`body`, `start` + 14, `end` - `start` - 13), ' ' || char(9) || char(13)) = ''
				THEN substr(`body`, 1, `end`) || char(10) || char(10) || `lines` || substr(`body`, `end` + 1)
			WHEN `body` = ''
				THEN '## Beziehungen' || char(10) || char(10) || `lines` || char(10)
			WHEN substr(`body`, -1) = char(10)
				THEN `body` || char(10) || '## Beziehungen' || char(10) || char(10) || `lines` || char(10)
			ELSE `body` || char(10) || char(10) || '## Beziehungen' || char(10) || char(10) || `lines` || char(10)
		END AS `body`
	FROM `placed`;
--> statement-breakpoint
UPDATE `npcs` SET `body` = (
	SELECT b.`body` FROM `__mig0014_relation_bodies` AS b
	WHERE b.`campaign_id` = `npcs`.`campaign_id` AND b.`npc_id` = `npcs`.`id`
)
WHERE EXISTS (
	SELECT 1 FROM `__mig0014_relation_bodies` AS b
	WHERE b.`campaign_id` = `npcs`.`campaign_id` AND b.`npc_id` = `npcs`.`id`
);--> statement-breakpoint
DROP TABLE `__mig0014_relation_bodies`;--> statement-breakpoint
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
