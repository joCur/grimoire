CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`description` text,
	`body` text DEFAULT '' NOT NULL,
	`extra` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chapters` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`status` text,
	`body` text DEFAULT '' NOT NULL,
	`extra` text DEFAULT '{}' NOT NULL,
	`pos` integer DEFAULT 0 NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
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
CREATE TABLE `inbox_entries` (
	`campaign_id` text NOT NULL,
	`pos` integer NOT NULL,
	`raw` text NOT NULL,
	`text` text,
	`done` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`campaign_id`, `pos`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`chapter_id` text,
	`roll20_page` text,
	`body` text DEFAULT '' NOT NULL,
	`extra` text DEFAULT '{}' NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `log_entries` (
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
	FOREIGN KEY (`campaign_id`,`session_id`) REFERENCES `sessions`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `migration_report` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` text NOT NULL,
	`path` text DEFAULT '' NOT NULL,
	`reason` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `npc_relations` (
	`campaign_id` text NOT NULL,
	`npc_id` text NOT NULL,
	`other_npc_id` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`pos` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `npc_id`, `other_npc_id`),
	FOREIGN KEY (`campaign_id`,`npc_id`) REFERENCES `npcs`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade
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
	`extra` text DEFAULT '{}' NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scene_npcs` (
	`campaign_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`npc_id` text NOT NULL,
	`pos` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `scene_id`, `npc_id`),
	FOREIGN KEY (`campaign_id`,`scene_id`) REFERENCES `scenes`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade
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
CREATE TABLE `scenes` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`chapter_id` text,
	`group_slug` text DEFAULT '' NOT NULL,
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
CREATE TABLE `session_scenes_played` (
	`campaign_id` text NOT NULL,
	`session_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`pos` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `session_id`, `scene_id`),
	FOREIGN KEY (`campaign_id`,`session_id`) REFERENCES `sessions`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`started` text,
	`ended` text,
	`body` text DEFAULT '' NOT NULL,
	`extra` text DEFAULT '{}' NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `unknown_files` (
	`campaign_id` text NOT NULL,
	`path` text NOT NULL,
	`content` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`campaign_id`, `path`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade
);
