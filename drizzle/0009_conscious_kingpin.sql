DROP INDEX `employees_email_unique`;--> statement-breakpoint
ALTER TABLE `employees` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `employees_scope_email_unique` ON `employees` (`data_scope`,`email`);--> statement-breakpoint
DROP INDEX `assets_tag_unique`;--> statement-breakpoint
ALTER TABLE `assets` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `assets_scope_tag_unique` ON `assets` (`data_scope`,`tag`);--> statement-breakpoint
ALTER TABLE `audit` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `benefit_enrollments` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `compensation_records` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `education_records` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `emergency_contacts` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `employee_identifiers` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `employee_profiles` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `employment_history` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `entitlements` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `announcement_reads` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `announcements` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `asset_history` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `document_acknowledgements` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `time_entries` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_templates` ADD `data_scope` text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `employee_photos` ADD `data_scope` text DEFAULT 'live' NOT NULL;
--> statement-breakpoint
-- Defense-in-depth: immutable scopes and same-scope references. No data seed.
CREATE TRIGGER employees_scope_insert BEFORE INSERT ON employees
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.manager_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.manager_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.manager_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER employees_scope_update BEFORE UPDATE ON employees
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.manager_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.manager_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.manager_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER leave_requests_scope_insert BEFORE INSERT ON leave_requests
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.required_manager_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.required_manager_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.required_manager_id AND r.data_scope<>NEW.data_scope))) OR (NEW.reviewer_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.reviewer_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.reviewer_id AND r.data_scope<>NEW.data_scope))) OR (NEW.attachment_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM documents r WHERE r.id=NEW.attachment_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM documents r WHERE r.id=NEW.attachment_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER leave_requests_scope_update BEFORE UPDATE ON leave_requests
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.required_manager_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.required_manager_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.required_manager_id AND r.data_scope<>NEW.data_scope))) OR (NEW.reviewer_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.reviewer_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.reviewer_id AND r.data_scope<>NEW.data_scope))) OR (NEW.attachment_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM documents r WHERE r.id=NEW.attachment_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM documents r WHERE r.id=NEW.attachment_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER documents_scope_insert BEFORE INSERT ON documents
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.owner_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.owner_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.owner_id AND r.data_scope<>NEW.data_scope))) OR (NEW.data_scope='qa-bots-v1' AND NEW.object_key NOT LIKE 'test/qa-bots-v1/documents/%') OR (NEW.data_scope='live' AND NEW.object_key LIKE 'test/%')
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER documents_scope_update BEFORE UPDATE ON documents
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.owner_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.owner_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.owner_id AND r.data_scope<>NEW.data_scope))) OR (NEW.data_scope='qa-bots-v1' AND NEW.object_key NOT LIKE 'test/qa-bots-v1/documents/%') OR (NEW.data_scope='live' AND NEW.object_key LIKE 'test/%')
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER events_scope_insert BEFORE INSERT ON events
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.created_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER events_scope_update BEFORE UPDATE ON events
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.created_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER audit_scope_insert BEFORE INSERT ON audit
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.actor_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.actor_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.actor_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER audit_scope_update BEFORE UPDATE ON audit
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.actor_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.actor_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.actor_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER tasks_scope_insert BEFORE INSERT ON tasks
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.assignee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.assignee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.assignee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.related_employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.related_employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.related_employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.workflow_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM workflow_runs r WHERE r.id=NEW.workflow_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM workflow_runs r WHERE r.id=NEW.workflow_id AND r.data_scope<>NEW.data_scope))) OR (NEW.created_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER tasks_scope_update BEFORE UPDATE ON tasks
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.assignee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.assignee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.assignee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.related_employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.related_employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.related_employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.workflow_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM workflow_runs r WHERE r.id=NEW.workflow_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM workflow_runs r WHERE r.id=NEW.workflow_id AND r.data_scope<>NEW.data_scope))) OR (NEW.created_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER entitlements_scope_insert BEFORE INSERT ON entitlements
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.updated_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.updated_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.updated_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER entitlements_scope_update BEFORE UPDATE ON entitlements
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.updated_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.updated_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.updated_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER employee_profiles_scope_insert BEFORE INSERT ON employee_profiles
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER employee_profiles_scope_update BEFORE UPDATE ON employee_profiles
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER emergency_contacts_scope_insert BEFORE INSERT ON emergency_contacts
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER emergency_contacts_scope_update BEFORE UPDATE ON emergency_contacts
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER employee_identifiers_scope_insert BEFORE INSERT ON employee_identifiers
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER employee_identifiers_scope_update BEFORE UPDATE ON employee_identifiers
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER compensation_records_scope_insert BEFORE INSERT ON compensation_records
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.created_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER compensation_records_scope_update BEFORE UPDATE ON compensation_records
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.created_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER employment_history_scope_insert BEFORE INSERT ON employment_history
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.created_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER employment_history_scope_update BEFORE UPDATE ON employment_history
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.created_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER education_records_scope_insert BEFORE INSERT ON education_records
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER education_records_scope_update BEFORE UPDATE ON education_records
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER benefit_enrollments_scope_insert BEFORE INSERT ON benefit_enrollments
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER benefit_enrollments_scope_update BEFORE UPDATE ON benefit_enrollments
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_templates_scope_insert BEFORE INSERT ON workflow_templates
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.created_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_templates_scope_update BEFORE UPDATE ON workflow_templates
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.created_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_runs_scope_insert BEFORE INSERT ON workflow_runs
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.template_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM workflow_templates r WHERE r.id=NEW.template_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM workflow_templates r WHERE r.id=NEW.template_id AND r.data_scope<>NEW.data_scope))) OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.created_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_runs_scope_update BEFORE UPDATE ON workflow_runs
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.template_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM workflow_templates r WHERE r.id=NEW.template_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM workflow_templates r WHERE r.id=NEW.template_id AND r.data_scope<>NEW.data_scope))) OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.created_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER assets_scope_insert BEFORE INSERT ON assets
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.assigned_to IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.assigned_to AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.assigned_to AND r.data_scope<>NEW.data_scope))) OR (NEW.created_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER assets_scope_update BEFORE UPDATE ON assets
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.assigned_to IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.assigned_to AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.assigned_to AND r.data_scope<>NEW.data_scope))) OR (NEW.created_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER asset_history_scope_insert BEFORE INSERT ON asset_history
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.asset_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM assets r WHERE r.id=NEW.asset_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM assets r WHERE r.id=NEW.asset_id AND r.data_scope<>NEW.data_scope))) OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.actor_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.actor_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.actor_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER asset_history_scope_update BEFORE UPDATE ON asset_history
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.asset_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM assets r WHERE r.id=NEW.asset_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM assets r WHERE r.id=NEW.asset_id AND r.data_scope<>NEW.data_scope))) OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.actor_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.actor_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.actor_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER announcements_scope_insert BEFORE INSERT ON announcements
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.created_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER announcements_scope_update BEFORE UPDATE ON announcements
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.created_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.created_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER announcement_reads_scope_insert BEFORE INSERT ON announcement_reads
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.announcement_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM announcements r WHERE r.id=NEW.announcement_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM announcements r WHERE r.id=NEW.announcement_id AND r.data_scope<>NEW.data_scope))) OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER announcement_reads_scope_update BEFORE UPDATE ON announcement_reads
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.announcement_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM announcements r WHERE r.id=NEW.announcement_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM announcements r WHERE r.id=NEW.announcement_id AND r.data_scope<>NEW.data_scope))) OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER time_entries_scope_insert BEFORE INSERT ON time_entries
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.required_manager_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.required_manager_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.required_manager_id AND r.data_scope<>NEW.data_scope))) OR (NEW.reviewed_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.reviewed_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.reviewed_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER time_entries_scope_update BEFORE UPDATE ON time_entries
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.required_manager_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.required_manager_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.required_manager_id AND r.data_scope<>NEW.data_scope))) OR (NEW.reviewed_by IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.reviewed_by AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.reviewed_by AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER document_acknowledgements_scope_insert BEFORE INSERT ON document_acknowledgements
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.document_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM documents r WHERE r.id=NEW.document_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM documents r WHERE r.id=NEW.document_id AND r.data_scope<>NEW.data_scope))) OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER document_acknowledgements_scope_update BEFORE UPDATE ON document_acknowledgements
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.document_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM documents r WHERE r.id=NEW.document_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM documents r WHERE r.id=NEW.document_id AND r.data_scope<>NEW.data_scope))) OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope)))
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER employee_photos_scope_insert BEFORE INSERT ON employee_photos
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.data_scope='qa-bots-v1' AND NEW.object_key NOT LIKE 'test/qa-bots-v1/photos/%') OR (NEW.data_scope='live' AND NEW.object_key LIKE 'test/%')
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER employee_photos_scope_update BEFORE UPDATE ON employee_photos
WHEN NEW.data_scope NOT IN ('live','qa-bots-v1') OR NEW.data_scope<>OLD.data_scope OR (NEW.employee_id IS NOT NULL AND ((NEW.data_scope='qa-bots-v1' AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope=NEW.data_scope)) OR EXISTS (SELECT 1 FROM employees r WHERE r.id=NEW.employee_id AND r.data_scope<>NEW.data_scope))) OR (NEW.data_scope='qa-bots-v1' AND NEW.object_key NOT LIKE 'test/qa-bots-v1/photos/%') OR (NEW.data_scope='live' AND NEW.object_key LIKE 'test/%')
BEGIN SELECT RAISE(ABORT, 'Data scope boundary rejected this operation'); END;
--> statement-breakpoint
CREATE TRIGGER source_employee_links_live_insert BEFORE INSERT ON source_employee_links
WHEN EXISTS (SELECT 1 FROM employees e WHERE e.id=NEW.employee_id AND e.data_scope<>'live')
BEGIN SELECT RAISE(ABORT, 'Source imports cannot reference test profiles'); END;
--> statement-breakpoint
CREATE TRIGGER source_employee_links_live_update BEFORE UPDATE ON source_employee_links
WHEN EXISTS (SELECT 1 FROM employees e WHERE e.id=NEW.employee_id AND e.data_scope<>'live')
BEGIN SELECT RAISE(ABORT, 'Source imports cannot reference test profiles'); END;
