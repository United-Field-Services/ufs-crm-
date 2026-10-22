CREATE TABLE `file_chunks` (
	`object_key` text NOT NULL,
	`idx` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`object_key`, `idx`)
);
