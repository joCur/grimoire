--> The trash (decisions/trash): a row of these tables that went to the trash
--> carries the moment it went there; NULL is a live row, which every
--> existing row is.
ALTER TABLE `chapters` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `ideas` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `locations` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `npcs` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `scenes` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `threads` ADD `deleted_at` text;