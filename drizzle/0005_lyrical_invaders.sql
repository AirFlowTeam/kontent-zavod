CREATE TABLE `telegram_accounts` (
	`telegram_user_id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`username` text,
	`display_name` text,
	`role` text,
	`selected_type` text,
	`pending_invite_hash` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "chk_telegram_accounts_role" CHECK("telegram_accounts"."role" IS NULL OR "telegram_accounts"."role" IN ('producer', 'creator')),
	CONSTRAINT "chk_telegram_accounts_type" CHECK("telegram_accounts"."selected_type" IS NULL OR "telegram_accounts"."selected_type" IN ('UGC', 'AI'))
);
--> statement-breakpoint
CREATE TABLE `telegram_invites` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`producer_id` integer NOT NULL,
	`creator_id` integer,
	`created_by` text NOT NULL,
	`update_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`redeemed_by` text,
	`redeemed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`producer_id`) REFERENCES `producers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `creators`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `telegram_accounts`(`telegram_user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_telegram_invites_update` ON `telegram_invites` (`created_by`,`update_id`);--> statement-breakpoint
CREATE INDEX `idx_telegram_invites_producer` ON `telegram_invites` (`producer_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `telegram_producer_links` (
	`telegram_user_id` text PRIMARY KEY NOT NULL,
	`producer_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`telegram_user_id`) REFERENCES `telegram_accounts`(`telegram_user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`producer_id`) REFERENCES `producers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_telegram_producer_links_producer` ON `telegram_producer_links` (`producer_id`);--> statement-breakpoint
ALTER TABLE `telegram_creator_links` ADD `type_confirmed_at` text;