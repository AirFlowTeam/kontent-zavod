CREATE TABLE `social_connect_tickets` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`channel_id` integer NOT NULL,
	`creator_id` integer NOT NULL,
	`telegram_user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `creator_channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `creators`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_social_tickets_channel` ON `social_connect_tickets` (`channel_id`);--> statement-breakpoint
CREATE TABLE `social_connections` (
	`channel_id` integer PRIMARY KEY NOT NULL,
	`creator_id` integer NOT NULL,
	`telegram_user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`username` text NOT NULL,
	`ciphertext` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` text,
	`refreshed_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `creator_channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `creators`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_social_connections_creator` ON `social_connections` (`creator_id`);