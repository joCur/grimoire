ALTER TABLE `generate_jobs` ADD `review` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `generate_jobs` ADD `rev` integer DEFAULT 0 NOT NULL;