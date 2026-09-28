--> The DM's own item lists: an import names its list, and each of its items
--> is an item price that names its import, priced by the list's own price or
--> by the SRD's value for its rarity. The shipped rows keep every value.
CREATE TABLE `item_price_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`skipped` text DEFAULT '[]' NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `__new_item_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`price_gp` integer NOT NULL,
	`list` text,
	`rarity` text,
	`source` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`import_id` text,
	`rev` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `item_price_imports`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "item_prices_list_check" CHECK(`list` is null or `list` in ('consumable', 'combat', 'noncombat', 'summoning', 'gamechanging')),
	CONSTRAINT "item_prices_rarity_check" CHECK(`rarity` is null or `rarity` in ('common', 'uncommon', 'rare', 'very-rare', 'legendary')),
	CONSTRAINT "item_prices_source_check" CHECK(`source` in ('saidoro', 'srd', 'import')),
	CONSTRAINT "item_prices_source_fields_check" CHECK((`source` = 'saidoro' and `list` is not null and `rarity` is null and `import_id` is null) or (`source` = 'srd' and `rarity` is not null and `list` is null) or (`source` = 'import' and `rarity` is not null and `list` is null and `import_id` is not null))
);
--> statement-breakpoint
INSERT INTO `__new_item_prices`("id", "name", "price_gp", "list", "rarity", "source", "note", "rev") SELECT "id", "name", "price_gp", "list", "rarity", "source", "note", "rev" FROM `item_prices`;--> statement-breakpoint
DROP TABLE `item_prices`;--> statement-breakpoint
ALTER TABLE `__new_item_prices` RENAME TO `item_prices`;
