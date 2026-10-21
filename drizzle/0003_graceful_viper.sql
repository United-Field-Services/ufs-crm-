ALTER TABLE `documents` ADD `folder` text DEFAULT 'Unsorted' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `expiry_date` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `pinned` integer DEFAULT 0 NOT NULL;