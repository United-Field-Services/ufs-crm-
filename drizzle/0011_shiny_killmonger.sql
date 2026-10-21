CREATE TABLE `auth_password_resets` (
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`not_before` integer NOT NULL,
	`locked` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`issuer`, `subject`)
);
