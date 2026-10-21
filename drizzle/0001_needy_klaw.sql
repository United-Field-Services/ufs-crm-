ALTER TABLE `employees` ADD `manager_id` text;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD `required_manager_id` text;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD `attachment_id` text;