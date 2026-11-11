--> The brainstorming chat of a scene: at most one live chat per scene, its
--> messages as rows of their own.
CREATE TABLE `scene_chat_messages` (
	`campaign_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`id` text NOT NULL,
	`role` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`pos` integer NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`campaign_id`, `chat_id`, `id`),
	FOREIGN KEY (`campaign_id`,`chat_id`) REFERENCES `scene_chats`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "scene_chat_messages_role_check" CHECK(`role` in ('dm', 'model')),
	CONSTRAINT "scene_chat_messages_status_check" CHECK(`status` in ('done', 'running', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `scene_chats` (
	`campaign_id` text NOT NULL,
	`id` text NOT NULL,
	`scene_id` text NOT NULL,
	`rev` integer DEFAULT 1 NOT NULL,
	`deleted_at` text,
	PRIMARY KEY(`campaign_id`, `id`),
	FOREIGN KEY (`campaign_id`,`scene_id`) REFERENCES `scenes`(`campaign_id`,`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scene_chats_live_scene_unique` ON `scene_chats` (`campaign_id`,`scene_id`) WHERE "scene_chats"."deleted_at" is null;