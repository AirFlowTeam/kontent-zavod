CREATE TABLE `social_oauth_sessions` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`ticket_hash` text NOT NULL,
	`browser_hash` text NOT NULL,
	`provider` text NOT NULL,
	`ciphertext` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`message` text,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`ticket_hash`) REFERENCES `social_connect_tickets`(`token_hash`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_social_oauth_ticket` ON `social_oauth_sessions` (`ticket_hash`);--> statement-breakpoint
CREATE INDEX `idx_social_oauth_expiry` ON `social_oauth_sessions` (`expires_at`);