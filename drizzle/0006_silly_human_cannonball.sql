CREATE TABLE `employee_photos` (
	`employee_id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`source_id` text NOT NULL,
	`imported_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_photos_object_key_unique` ON `employee_photos` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `employee_photos_source_id_unique` ON `employee_photos` (`source_id`);