CREATE TABLE `telegram_creator_links` (
	`telegram_user_id` text PRIMARY KEY NOT NULL,
	`creator_id` integer NOT NULL,
	`chat_id` text NOT NULL,
	`username` text,
	`display_name` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `creators`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_telegram_creator_links_creator_id` ON `telegram_creator_links` (`creator_id`);--> statement-breakpoint
CREATE TABLE `telegram_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`update_id` integer NOT NULL,
	`telegram_user_id` text NOT NULL,
	`creator_id` integer NOT NULL,
	`channel_id` integer NOT NULL,
	`source_kind` text NOT NULL,
	`result_status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`telegram_user_id`) REFERENCES `telegram_creator_links`(`telegram_user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `creators`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `creator_channels`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_telegram_submissions_source_kind" CHECK("telegram_submissions"."source_kind" IN ('channel', 'video')),
	CONSTRAINT "chk_telegram_submissions_result_status" CHECK("telegram_submissions"."result_status" IN ('created', 'existing'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_telegram_submissions_update_id` ON `telegram_submissions` (`update_id`);--> statement-breakpoint
CREATE INDEX `idx_telegram_submissions_user_created` ON `telegram_submissions` (`telegram_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_telegram_submissions_channel_id` ON `telegram_submissions` (`channel_id`);