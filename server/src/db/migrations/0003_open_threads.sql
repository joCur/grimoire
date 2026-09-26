--> The open threads of a chapter become a list of rows (ADR #29).
-->
--> A new table and the list's own guard counter on the chapter, and no data
--> step: the list starts empty. An existing `## Offene Fäden` section stays
--> where it is, as free text of the chapter's body — nothing is cut out of a
--> body, and nothing reads it as data any more.
CREATE TABLE `threads` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`text` text NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`pos` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`,`chapter_id`) REFERENCES `chapters`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `chapters` ADD `threads_rev` integer DEFAULT 1 NOT NULL;