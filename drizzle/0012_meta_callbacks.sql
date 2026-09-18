CREATE TABLE `meta_account_links` (
	`channel_id` integer PRIMARY KEY NOT NULL,
	`creator_id` integer NOT NULL,
	`provider` text NOT NULL,
	`app_id` text NOT NULL,
	`subject_hash` text NOT NULL,
	`authorized_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `creator_channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_id`) REFERENCES `creators`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chk_meta_provider" CHECK("meta_account_links"."provider" IN ('instagram','threads')),
	CONSTRAINT "chk_meta_authorized_at" CHECK("meta_account_links"."authorized_at" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_meta_subject` ON `meta_account_links` (`provider`,`app_id`,`subject_hash`);--> statement-breakpoint
CREATE TABLE `meta_callback_receipts` (
	`event_hash` text PRIMARY KEY NOT NULL,
	`confirmation_code` text NOT NULL,
	`provider` text NOT NULL,
	`app_id` text NOT NULL,
	`subject_hash` text NOT NULL,
	`issued_at` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`affected_channels` integer DEFAULT 0 NOT NULL,
	`target_ids` text,
	`processed_at` text NOT NULL,
	CONSTRAINT "chk_meta_receipt_provider" CHECK("meta_callback_receipts"."provider" IN ('instagram','threads')),
	CONSTRAINT "chk_meta_receipt_kind" CHECK("meta_callback_receipts"."kind" IN ('deauthorize','data-deletion')),
	CONSTRAINT "chk_meta_receipt_status" CHECK("meta_callback_receipts"."status" IN ('processing','operational_deleted','deauthorized','no_matching_data','newer_connection_preserved'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meta_callback_receipts_confirmation_code_unique` ON `meta_callback_receipts` (`confirmation_code`);--> statement-breakpoint
CREATE INDEX `idx_meta_callback_subject` ON `meta_callback_receipts` (`provider`,`app_id`,`subject_hash`,`issued_at`);