CREATE TABLE `video_url_aliases` (
	`canonical_url` text PRIMARY KEY NOT NULL,
	`video_id` integer NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_video_url_aliases_video_id` ON `video_url_aliases` (`video_id`);