CREATE TABLE `campaign_knowledge` (
	`campaign_id` text NOT NULL,
	`pos` integer NOT NULL,
	`kind` text DEFAULT 'fact' NOT NULL,
	`from_text` text DEFAULT '' NOT NULL,
	`to_text` text DEFAULT '' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `pos`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `campaigns` ADD `knowledge_rev` integer DEFAULT 1 NOT NULL;