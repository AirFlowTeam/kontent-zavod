CREATE TABLE `telegram_channel_rechecks` (
	`channel_id` integer PRIMARY KEY NOT NULL,
	`requested_at` text NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `creator_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `telegram_journey_platforms` (
	`creator_id` integer NOT NULL,
	`platform_name` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`creator_id`, `platform_name`),
	FOREIGN KEY (`creator_id`) REFERENCES `creators`(`id`) ON UPDATE no action ON DELETE cascade
);
