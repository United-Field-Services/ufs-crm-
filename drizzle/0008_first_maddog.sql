CREATE TABLE `auth_session_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `auth_sessions`(`session_id`) ON UPDATE no action ON DELETE no action
);
