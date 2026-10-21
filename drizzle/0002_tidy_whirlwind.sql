CREATE TABLE `benefit_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`type` text NOT NULL,
	`plan` text NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`coverage` text DEFAULT '' NOT NULL,
	`cost` real,
	`currency` text DEFAULT '' NOT NULL,
	`period` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`effective_date` text NOT NULL,
	`end_date` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `compensation_records` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`frequency` text NOT NULL,
	`record_type` text DEFAULT 'Salary' NOT NULL,
	`pay_schedule` text DEFAULT '' NOT NULL,
	`overtime_status` text DEFAULT '' NOT NULL,
	`effective_date` text NOT NULL,
	`reason` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `education_records` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`institution` text NOT NULL,
	`degree` text DEFAULT '' NOT NULL,
	`field_of_study` text DEFAULT '' NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`graduation_date` text DEFAULT '' NOT NULL,
	`start_date` text DEFAULT '' NOT NULL,
	`end_date` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Completed' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `emergency_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`name` text NOT NULL,
	`relationship` text NOT NULL,
	`phone` text NOT NULL,
	`alternate_phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `employee_identifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`type` text NOT NULL,
	`country` text NOT NULL,
	`expiry_date` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`last4` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `employee_profiles` (
	`employee_id` text PRIMARY KEY NOT NULL,
	`legal_first_name` text DEFAULT '' NOT NULL,
	`legal_last_name` text DEFAULT '' NOT NULL,
	`preferred_name` text DEFAULT '' NOT NULL,
	`birth_date` text DEFAULT '' NOT NULL,
	`gender` text DEFAULT '' NOT NULL,
	`marital_status` text DEFAULT '' NOT NULL,
	`nationality` text DEFAULT '' NOT NULL,
	`citizenship` text DEFAULT '' NOT NULL,
	`personal_email` text DEFAULT '' NOT NULL,
	`personal_phone` text DEFAULT '' NOT NULL,
	`work_phone` text DEFAULT '' NOT NULL,
	`work_phone_public` integer DEFAULT 0 NOT NULL,
	`address_line1` text DEFAULT '' NOT NULL,
	`address_line2` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`state` text DEFAULT '' NOT NULL,
	`postal_code` text DEFAULT '' NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`secondary_address_line1` text DEFAULT '' NOT NULL,
	`secondary_address_line2` text DEFAULT '' NOT NULL,
	`secondary_city` text DEFAULT '' NOT NULL,
	`secondary_state` text DEFAULT '' NOT NULL,
	`secondary_postal_code` text DEFAULT '' NOT NULL,
	`secondary_country` text DEFAULT '' NOT NULL,
	`linkedin` text DEFAULT '' NOT NULL,
	`languages` text DEFAULT '' NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`employee_number` text DEFAULT '' NOT NULL,
	`legal_entity` text DEFAULT '' NOT NULL,
	`division` text DEFAULT '' NOT NULL,
	`timezone` text DEFAULT '' NOT NULL,
	`work_schedule` text DEFAULT '' NOT NULL,
	`work_arrangement` text DEFAULT '' NOT NULL,
	`hours_per_day` real,
	`employment_status` text DEFAULT 'Active' NOT NULL,
	`probation_end` text DEFAULT '' NOT NULL,
	`contract_end` text DEFAULT '' NOT NULL,
	`exit_date` text DEFAULT '' NOT NULL,
	`exit_reason` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `employment_history` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`effective_date` text NOT NULL,
	`reason` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `announcement_reads` (
	`id` text PRIMARY KEY NOT NULL,
	`announcement_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`read_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`category` text DEFAULT 'Company news' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`published_at` text
);
--> statement-breakpoint
CREATE TABLE `asset_history` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`employee_id` text,
	`action` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`tag` text NOT NULL,
	`serial` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`assigned_to` text,
	`assigned_at` text,
	`return_due` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_tag_unique` ON `assets` (`tag`);--> statement-breakpoint
CREATE TABLE `document_acknowledgements` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`acknowledged_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`date` text NOT NULL,
	`minutes` integer NOT NULL,
	`project` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`required_manager_id` text,
	`review_note` text DEFAULT '' NOT NULL,
	`reviewed_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`start_date` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`steps` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `workflow_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `description` text DEFAULT '' NOT NULL;