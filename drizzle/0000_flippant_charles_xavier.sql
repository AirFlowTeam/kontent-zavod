CREATE TABLE `creators` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`producer_id` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`producer_id`) REFERENCES `producers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_creators_name` ON `creators` (`name`);--> statement-breakpoint
CREATE INDEX `idx_creators_producer_id` ON `creators` (`producer_id`);--> statement-breakpoint
CREATE TABLE `platforms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`domains` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_platforms_name` ON `platforms` (`name`);--> statement-breakpoint
CREATE TABLE `producers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_producers_name` ON `producers` (`name`);--> statement-breakpoint
CREATE TABLE `reach_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` integer NOT NULL,
	`reach` integer NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_reach_history_video_id` ON `reach_history` (`video_id`);--> statement-breakpoint
CREATE TABLE `videos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`creator_id` integer NOT NULL,
	`platform_id` integer NOT NULL,
	`url` text NOT NULL,
	`normalized_url` text NOT NULL,
	`published_at` text NOT NULL,
	`added_at` text NOT NULL,
	`reach` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`creator_type_snapshot` text NOT NULL,
	`producer_id_snapshot` integer NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `creators`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_videos_normalized_url` ON `videos` (`normalized_url`);--> statement-breakpoint
CREATE INDEX `idx_videos_creator_id` ON `videos` (`creator_id`);--> statement-breakpoint
CREATE INDEX `idx_videos_platform_id` ON `videos` (`platform_id`);--> statement-breakpoint
CREATE INDEX `idx_videos_status_published_at` ON `videos` (`status`,`published_at`);