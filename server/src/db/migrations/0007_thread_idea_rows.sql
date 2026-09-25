--> A thread and an idea are each an entity of their own (ADR #31): every row
--> carries its own guard `rev`, and the list counters `chapters.threads_rev`
--> and `campaigns.inbox_rev` are gone.
-->
--> An idea gets a stable opaque `id` (the shape of a random UUID) in place of
--> its position as the key; `pos` stays as the order of creation. The table
--> is rebuilt as `ideas`, and every idea keeps its text, its `done` and its
--> order.
ALTER TABLE `threads` ADD `rev` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `chapters` DROP COLUMN `threads_rev`;--> statement-breakpoint
CREATE TABLE `ideas` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`pos` integer NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `ideas` (`campaign_id`, `id`, `text`, `done`, `pos`)
SELECT
  `campaign_id`,
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
  `text`,
  `done`,
  `pos`
FROM `inbox_entries`;--> statement-breakpoint
DROP TABLE `inbox_entries`;--> statement-breakpoint
ALTER TABLE `campaigns` DROP COLUMN `inbox_rev`;
