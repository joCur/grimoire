ALTER TABLE `campaigns` ADD `glossary_intro` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `glossary_rev` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `inbox_rev` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `scenes` ADD `chapter_declared` integer DEFAULT 1 NOT NULL;