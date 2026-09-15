DROP INDEX `idx_telegram_submissions_update_id`;--> statement-breakpoint
ALTER TABLE `telegram_submissions` ADD `item_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_telegram_submissions_update_item` ON `telegram_submissions` (`update_id`,`item_index`);