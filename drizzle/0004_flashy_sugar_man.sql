CREATE TABLE `migration_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`source_origin` text NOT NULL,
	`digest` text NOT NULL,
	`counts_json` text NOT NULL,
	`imported_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_employee_links` (
	`source_id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`source_email` text NOT NULL,
	`directory_phone` text DEFAULT '' NOT NULL,
	`manager_source_id` text,
	`manager_name` text DEFAULT '' NOT NULL,
	`source_status` text DEFAULT '' NOT NULL,
	`source_employment_type` text DEFAULT '' NOT NULL,
	`imported_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_employee_links_employee_id_unique` ON `source_employee_links` (`employee_id`);--> statement-breakpoint
CREATE TABLE `source_hr_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`settings_json` text NOT NULL,
	`imported_at` text NOT NULL
);
