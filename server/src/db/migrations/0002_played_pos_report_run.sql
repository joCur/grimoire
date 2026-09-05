PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session_scenes_played` (
	`campaign_id` text NOT NULL,
	`session_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`pos` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `session_id`, `pos`),
	FOREIGN KEY (`campaign_id`,`session_id`) REFERENCES `sessions`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_session_scenes_played`("campaign_id", "session_id", "scene_id", "pos") SELECT "campaign_id", "session_id", "scene_id", "pos" FROM `session_scenes_played`;--> statement-breakpoint
DROP TABLE `session_scenes_played`;--> statement-breakpoint
ALTER TABLE `__new_session_scenes_played` RENAME TO `session_scenes_played`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `migration_report` ADD `run_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `unknown_files` ADD `content_blob` blob;