--> A pause, a log entry and a played scene are each an entity of their own
--> (ADR #31): every row carries a stable opaque `id` (the shape of a random
--> UUID) in place of its position as the key, and its own guard `rev`. `pos`
--> stays as the order within the session.
-->
--> The three tables are rebuilt — the pauses as `pauses`, the played scenes as
--> `played_scenes` —, and every row keeps its session, its content and its
--> order. A log entry is named by its id alone, so its `hash` column goes.
CREATE TABLE `pauses` (
	`campaign_id` text NOT NULL,
	`session_id` text NOT NULL,
	`id` text NOT NULL,
	`from_ts` text NOT NULL,
	`to_ts` text,
	`pos` integer NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `session_id`, `id`),
	FOREIGN KEY (`campaign_id`,`session_id`) REFERENCES `sessions`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `pauses` (`campaign_id`, `session_id`, `id`, `from_ts`, `to_ts`, `pos`)
SELECT
  `campaign_id`,
  `session_id`,
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
  `from_ts`,
  `to_ts`,
  `pos`
FROM `session_pauses`;--> statement-breakpoint
DROP TABLE `session_pauses`;--> statement-breakpoint
CREATE TABLE `played_scenes` (
	`campaign_id` text NOT NULL,
	`session_id` text NOT NULL,
	`id` text NOT NULL,
	`scene_id` text NOT NULL,
	`pos` integer NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `session_id`, `id`),
	FOREIGN KEY (`campaign_id`,`session_id`) REFERENCES `sessions`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`scene_id`) REFERENCES `scenes`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action
);--> statement-breakpoint
INSERT INTO `played_scenes` (`campaign_id`, `session_id`, `id`, `scene_id`, `pos`)
SELECT
  `campaign_id`,
  `session_id`,
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
  `scene_id`,
  `pos`
FROM `session_scenes_played`;--> statement-breakpoint
DROP TABLE `session_scenes_played`;--> statement-breakpoint
CREATE TABLE `__new_log_entries` (
	`campaign_id` text NOT NULL,
	`session_id` text NOT NULL,
	`id` text NOT NULL,
	`at` text,
	`scene_id` text,
	`text` text DEFAULT '' NOT NULL,
	`reviewed` integer DEFAULT 0 NOT NULL,
	`pos` integer NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `session_id`, `id`),
	FOREIGN KEY (`campaign_id`,`session_id`) REFERENCES `sessions`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`campaign_id`,`scene_id`) REFERENCES `scenes`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_log_entries` (`campaign_id`, `session_id`, `id`, `at`, `scene_id`, `text`, `reviewed`, `pos`)
SELECT
  `campaign_id`,
  `session_id`,
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
  `at`,
  `scene_id`,
  `text`,
  `reviewed`,
  `pos`
FROM `log_entries`;--> statement-breakpoint
DROP TABLE `log_entries`;--> statement-breakpoint
ALTER TABLE `__new_log_entries` RENAME TO `log_entries`;
