CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`data_scope` text DEFAULT 'live' NOT NULL,
	`recipient_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`link` text DEFAULT '/' NOT NULL,
	`related_id` text,
	`dedupe_key` text NOT NULL,
	`in_app` integer DEFAULT 1 NOT NULL,
	`email_mode` text DEFAULT 'off' NOT NULL,
	`digest_pending` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	FOREIGN KEY (`recipient_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe` ON `notifications` (`recipient_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_inbox` ON `notifications` (`recipient_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`employee_id` text NOT NULL,
	`kind` text NOT NULL,
	`in_app` integer DEFAULT 1 NOT NULL,
	`email` text DEFAULT 'instant' NOT NULL,
	PRIMARY KEY(`employee_id`, `kind`),
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `email_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` text,
	`to_address` text NOT NULL,
	`subject` text NOT NULL,
	`text_body` text NOT NULL,
	`html_body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`claimed_at` text,
	`sent_at` text
);
--> statement-breakpoint
CREATE INDEX `email_outbox_pending` ON `email_outbox` (`status`,`created_at`);
