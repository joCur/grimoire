CREATE TABLE `random_table_rows` (
	`table_id` text NOT NULL,
	`pos` integer NOT NULL,
	`min` integer,
	`max` integer,
	`cells` text DEFAULT '[]' NOT NULL,
	PRIMARY KEY(`table_id`, `pos`),
	FOREIGN KEY (`table_id`) REFERENCES `random_tables`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "random_table_rows_range_check" CHECK((`min` is null and `max` is null) or (`min` is not null and `max` is not null and `min` <= `max`))
);
--> statement-breakpoint
CREATE TABLE `random_table_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`authors` text DEFAULT '[]' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `random_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`pos` integer NOT NULL,
	`name` text NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`intro` text DEFAULT '' NOT NULL,
	`die` integer,
	`columns` text DEFAULT '[]' NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `random_table_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `random_tables_source_idx` ON `random_tables` (`source_id`,`pos`);