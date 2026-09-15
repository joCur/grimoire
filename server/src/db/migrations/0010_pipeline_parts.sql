ALTER TABLE `generate_jobs` ADD `pipeline` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `generate_jobs` ADD `source_text` text;--> statement-breakpoint
ALTER TABLE `generate_jobs` ADD `new_chapter` integer DEFAULT 0 NOT NULL;