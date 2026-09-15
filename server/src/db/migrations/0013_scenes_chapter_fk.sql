-- ADR #18: `scenes.chapter_id` becomes a REAL foreign key.
--
-- The orphan rows this would fail on are gone by the time it runs: the
-- pre-migration repair of db/chapter-repair.ts creates the missing chapter
-- rows on the raw client, BEFORE the migrator opens its transaction.
--
-- HAND-EDITED, and the deviation from what drizzle-kit generated matters.
-- SQLite cannot add a foreign key to an existing table, so a rebuild it is;
-- what the generated version does around that rebuild does not survive our
-- migrator. It brackets the work in `PRAGMA foreign_keys=OFF/ON`, and
-- `db/client.ts` runs the whole file inside ONE transaction (drizzle's
-- dialect) where that pragma is a documented NO-OP. With enforcement still
-- on, `DROP TABLE scenes` cascades into `scene_npcs` and `scene_tags` — both
-- reference `scenes` ON DELETE CASCADE — and every scene's npc and tag rows
-- are silently gone. (`PRAGMA legacy_alter_table` is no escape either: it
-- does not take effect inside the transaction, and the rename then rewrites
-- the children's references to the OLD table.)
--
-- So the child rows are set aside and put back, and the rebuild itself keeps
-- drizzle's shape:
--
--   * the children's foreign keys name `scenes` by NAME. Dropping the old
--     table does not rewrite them, and renaming `__new_scenes` INTO that name
--     only rewrites references to `__new_scenes` — so after the swap they
--     resolve to the new table, which is the table they were always about.
--   * the copies are plain tables, restored in the same transaction. Either
--     the whole migration commits or none of it does.
--
-- The column list is the scene columns as of migration 0011, which dropped
-- `chapter_declared`: the rebuilt table and the explicit INSERT list have to
-- name exactly the columns the previous migration left behind, so the copy
-- is spelled out rather than a `SELECT *`.
CREATE TABLE `__keep_scene_npcs` AS SELECT * FROM `scene_npcs`;--> statement-breakpoint
CREATE TABLE `__keep_scene_tags` AS SELECT * FROM `scene_tags`;--> statement-breakpoint
CREATE TABLE `__new_scenes` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`chapter_id` text,
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
	FOREIGN KEY (`campaign_id`,`chapter_id`) REFERENCES `chapters`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_scenes`("campaign_id", "id", "chapter_id", "title", "type", "trigger", "location", "status", "handouts", "body", "extra", "pos", "rev") SELECT "campaign_id", "id", "chapter_id", "title", "type", "trigger", "location", "status", "handouts", "body", "extra", "pos", "rev" FROM `scenes`;--> statement-breakpoint
DROP TABLE `scenes`;--> statement-breakpoint
ALTER TABLE `__new_scenes` RENAME TO `scenes`;--> statement-breakpoint
INSERT INTO `scene_npcs` SELECT * FROM `__keep_scene_npcs`;--> statement-breakpoint
INSERT INTO `scene_tags` SELECT * FROM `__keep_scene_tags`;--> statement-breakpoint
DROP TABLE `__keep_scene_npcs`;--> statement-breakpoint
DROP TABLE `__keep_scene_tags`;
