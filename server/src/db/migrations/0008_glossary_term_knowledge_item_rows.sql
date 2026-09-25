--> A glossary term and a knowledge item are each an entity of their own
--> (ADR #31): every row carries a stable opaque `id` (the shape of a random
--> UUID) and its own guard `rev`, and the list counters
--> `campaigns.glossary_rev` and `campaigns.knowledge_rev` are gone.
-->
--> A glossary term was keyed by its text, a knowledge item by its position.
--> Both tables are rebuilt as `glossary_terms` and `knowledge_items`, and
--> every row keeps its content and its order (`pos`). A term stays unique
--> within its campaign. The order of the knowledge items gets its own guard,
--> `campaigns.knowledge_item_order_rev`.
-->
--> The search index names a term by its new id under the kind
--> `glossary-term`, so its rows are written again from the rebuilt table.
CREATE TABLE `glossary_terms` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`term` text NOT NULL,
	`explanation` text DEFAULT '' NOT NULL,
	`pos` integer NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `glossary_terms_term_unique` ON `glossary_terms` (`campaign_id`,`term`);--> statement-breakpoint
INSERT INTO `glossary_terms` (`campaign_id`, `id`, `term`, `explanation`, `pos`)
SELECT
  `campaign_id`,
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
  `term`,
  `explanation`,
  `pos`
FROM `glossary`;--> statement-breakpoint
DROP TABLE `glossary`;--> statement-breakpoint
DELETE FROM `search_fts` WHERE `kind` = 'glossary';--> statement-breakpoint
INSERT INTO `search_fts` (`title`, `ref`, `tags`, `body`, `campaign_id`, `kind`, `entity_id`)
SELECT `term`, `term`, '', `explanation`, `campaign_id`, 'glossary-term', `id`
FROM `glossary_terms`;--> statement-breakpoint
CREATE TABLE `knowledge_items` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`kind` text DEFAULT 'fact' NOT NULL,
	`from_text` text DEFAULT '' NOT NULL,
	`to_text` text DEFAULT '' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`pos` integer NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE cascade ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `knowledge_items` (`campaign_id`, `id`, `kind`, `from_text`, `to_text`, `text`, `pos`)
SELECT
  `campaign_id`,
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
  `kind`,
  `from_text`,
  `to_text`,
  `text`,
  `pos`
FROM `campaign_knowledge`;--> statement-breakpoint
DROP TABLE `campaign_knowledge`;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `knowledge_item_order_rev` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` DROP COLUMN `glossary_rev`;--> statement-breakpoint
ALTER TABLE `campaigns` DROP COLUMN `knowledge_rev`;
