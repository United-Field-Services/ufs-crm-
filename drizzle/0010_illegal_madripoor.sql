CREATE TABLE `qa_provisioning_checks` (
	`id` integer PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "qa_provisioning_singleton" CHECK("qa_provisioning_checks"."id"=1),
	CONSTRAINT "qa_provisioning_complete" CHECK("qa_provisioning_checks"."valid"=1)
);
