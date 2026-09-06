CREATE TABLE `channel_sync_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` integer NOT NULL,
	`status` text NOT NULL,
	`observed_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`source` text,
	`error_message` text,
	`provider_channel_id` text,
	`handle` text,
	`title` text,
	`avatar_url` text,
	`followers` integer,
	`total_views` integer,
	`publication_count` integer,
	`reach_30d` integer,
	`creator_type_snapshot` text NOT NULL,
	`producer_id_snapshot` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `creator_channels`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_channel_sync_history_status" CHECK("channel_sync_history"."status" IN ('success', 'error', 'needs_auth')),
	CONSTRAINT "chk_channel_sync_history_followers" CHECK("channel_sync_history"."followers" IS NULL OR "channel_sync_history"."followers" >= 0),
	CONSTRAINT "chk_channel_sync_history_total_views" CHECK("channel_sync_history"."total_views" IS NULL OR "channel_sync_history"."total_views" >= 0),
	CONSTRAINT "chk_channel_sync_history_publication_count" CHECK("channel_sync_history"."publication_count" IS NULL OR "channel_sync_history"."publication_count" >= 0),
	CONSTRAINT "chk_channel_sync_history_reach_30d" CHECK("channel_sync_history"."reach_30d" IS NULL OR "channel_sync_history"."reach_30d" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_channel_sync_history_observation` ON `channel_sync_history` (`channel_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `idx_channel_sync_history_channel_recorded` ON `channel_sync_history` (`channel_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_channel_sync_history_status_recorded` ON `channel_sync_history` (`status`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `creator_channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`creator_id` integer NOT NULL,
	`platform_id` integer NOT NULL,
	`url` text NOT NULL,
	`normalized_url` text NOT NULL,
	`provider_channel_id` text,
	`handle` text,
	`title` text,
	`avatar_url` text,
	`followers` integer,
	`total_views` integer,
	`publication_count` integer,
	`reach_30d` integer,
	`followers_override` integer,
	`total_views_override` integer,
	`publication_count_override` integer,
	`reach_30d_override` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`sync_error` text,
	`sync_source` text,
	`last_synced_at` text,
	`metrics_updated_at` text,
	`next_sync_at` text,
	`lease_until` text,
	`lease_token` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `creators`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_creator_channels_status" CHECK("creator_channels"."status" IN ('active', 'inactive')),
	CONSTRAINT "chk_creator_channels_sync_status" CHECK("creator_channels"."sync_status" IN ('pending', 'success', 'error', 'needs_auth')),
	CONSTRAINT "chk_creator_channels_followers" CHECK("creator_channels"."followers" IS NULL OR "creator_channels"."followers" >= 0),
	CONSTRAINT "chk_creator_channels_total_views" CHECK("creator_channels"."total_views" IS NULL OR "creator_channels"."total_views" >= 0),
	CONSTRAINT "chk_creator_channels_publication_count" CHECK("creator_channels"."publication_count" IS NULL OR "creator_channels"."publication_count" >= 0),
	CONSTRAINT "chk_creator_channels_reach_30d" CHECK("creator_channels"."reach_30d" IS NULL OR "creator_channels"."reach_30d" >= 0),
	CONSTRAINT "chk_creator_channels_followers_override" CHECK("creator_channels"."followers_override" IS NULL OR "creator_channels"."followers_override" >= 0),
	CONSTRAINT "chk_creator_channels_total_views_override" CHECK("creator_channels"."total_views_override" IS NULL OR "creator_channels"."total_views_override" >= 0),
	CONSTRAINT "chk_creator_channels_publication_count_override" CHECK("creator_channels"."publication_count_override" IS NULL OR "creator_channels"."publication_count_override" >= 0),
	CONSTRAINT "chk_creator_channels_reach_30d_override" CHECK("creator_channels"."reach_30d_override" IS NULL OR "creator_channels"."reach_30d_override" >= 0),
	CONSTRAINT "chk_creator_channels_failure_count" CHECK("creator_channels"."consecutive_failures" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_creator_channels_normalized_url` ON `creator_channels` (`normalized_url`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_creator_channels_provider_id` ON `creator_channels` (`platform_id`,`provider_channel_id`);--> statement-breakpoint
CREATE INDEX `idx_creator_channels_creator_id` ON `creator_channels` (`creator_id`);--> statement-breakpoint
CREATE INDEX `idx_creator_channels_platform_id` ON `creator_channels` (`platform_id`);--> statement-breakpoint
CREATE INDEX `idx_creator_channels_due` ON `creator_channels` (`status`,`next_sync_at`,`lease_until`);--> statement-breakpoint
CREATE INDEX `idx_creator_channels_lease_token` ON `creator_channels` (`lease_token`);