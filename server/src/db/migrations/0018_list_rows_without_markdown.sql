--> Log and inbox rows lose their markdown line.
-->
--> `log_entries.raw` and `inbox_entries.raw` held the line as it was written,
--> next to the columns parsed out of it. Two truths about one note, and the
--> line was the one the reader used — so a session's log and the inbox were
--> still texts that got parsed back into rows. Since ADR #26 both are TABLES
--> the API answers as rows: the columns are all there is, and `text` is NOT
--> NULL because a row without one says nothing.
-->
--> HAND-WRITTEN, like 0014 and 0016, for three reasons a generated rebuild
--> cannot cover:
-->
-->   1. The SKELETON ROWS GO. A markdown list needs headings and markers, a
-->      table does not: the inbox's `# Inbox`/`## Eingang` heading rows and the
-->      log's `— Pause`/`— Weiter` marker rows carried the SHAPE of the text,
-->      never content. The pauses are `session_pauses` rows already — the
-->      marker line was the same pause written a second time — and a heading is
-->      the title of a list that has one. Deleting them is lossless; keeping
-->      them would put an idea called "Eingang" in the inbox.
-->
-->      An inbox heading is recognised by having NO TEXT, not by the `#` in
-->      the line it was written as: the pre-flight below refuses every OTHER
-->      text-less row, so "no text" and "heading" name the same rows here.
-->      That is also what keeps this migration re-runnable — it reads no
-->      column it is about to drop.
-->   2. `pos` IS RENUMBERED. It is the append counter and the key, and the
-->      deletions above would leave holes in it. `row_number()` closes them in
-->      the stored order, so the sequence stays gap-less and the order is
-->      exactly the one the rows had.
-->   3. NOTHING IS GUESSED. A row whose `text` is empty for any OTHER reason
-->      is a line this migration cannot turn into a note — and it does not
-->      try. The pre-flight (db/list-rows-preflight.ts) runs BEFORE the
-->      migrator and REFUSES the start naming campaign, session, position and
-->      the line, so such a database arrives here only after the DM has said
-->      what those rows were.
-->
--> The rebuild itself follows 0016: the migrator runs in a transaction in
--> which `PRAGMA foreign_keys` is ignored, and both tables are leaves — no
--> child table hangs off them — so dropping and renaming them cascades into
--> nothing.
-->
--> `hash` is carried over UNCHANGED. It is a log row's id, the short hash of
--> its canonical line `- HH:MM (scene-id) text` (store/body-parse.ts), and
--> those are exactly the columns that survive here: a row keeps the id it has
--> always had.

DELETE FROM `log_entries` WHERE trim(`text`) IN ('— Pause', '— Weiter');--> statement-breakpoint
DELETE FROM `inbox_entries` WHERE `text` IS NULL OR trim(`text`) = '';--> statement-breakpoint
CREATE TABLE `__new_log_entries` (
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
INSERT INTO `__new_log_entries`
	("campaign_id", "session_id", "pos", "at", "scene_id", "text", "hash", "reviewed")
SELECT "campaign_id", "session_id",
	row_number() OVER (PARTITION BY "campaign_id", "session_id" ORDER BY "pos") - 1,
	"at", "scene_id", coalesce("text", ''), "hash", "reviewed"
FROM `log_entries`;--> statement-breakpoint
DROP TABLE `log_entries`;--> statement-breakpoint
ALTER TABLE `__new_log_entries` RENAME TO `log_entries`;--> statement-breakpoint
CREATE TABLE `__new_inbox_entries` (
	`campaign_id` text NOT NULL,
	`pos` integer NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`campaign_id`, `pos`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_inbox_entries`("campaign_id", "pos", "text", "done")
SELECT "campaign_id",
	row_number() OVER (PARTITION BY "campaign_id" ORDER BY "pos") - 1,
	coalesce("text", ''), "done"
FROM `inbox_entries`;--> statement-breakpoint
DROP TABLE `inbox_entries`;--> statement-breakpoint
ALTER TABLE `__new_inbox_entries` RENAME TO `inbox_entries`;
