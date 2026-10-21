import { sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const employees = sqliteTable('employees', {
 dataScope:text('data_scope').notNull().default('live'),
  id: text('id').primaryKey(), userId: text('user_id').unique(), email: text('email').notNull(),
  name: text('name').notNull(), title: text('title').notNull(), department: text('department').notNull(),
  location: text('location').notNull(), employment: text('employment').notNull(), hireDate: text('hire_date').notNull(),
  managerId: text('manager_id'),
  role: text('role').notNull().default('employee'), active: integer('active').notNull().default(1),
  annualAllowance: real('annual_allowance').notNull().default(15), sickAllowance: real('sick_allowance').notNull().default(5),
  wfhAllowance: real('wfh_allowance').notNull().default(30), bereavementAllowance: real('bereavement_allowance').notNull().default(3),
  demo: integer('demo').notNull().default(0), createdAt: text('created_at').notNull()
},table=>[uniqueIndex('employees_scope_email_unique').on(table.dataScope,table.email)]);
export const leaveRequests = sqliteTable('leave_requests', {
 dataScope:text('data_scope').notNull().default('live'),
  id: text('id').primaryKey(), employeeId: text('employee_id').notNull().references(()=>employees.id),
  type: text('type').notNull(), startDate: text('start_date').notNull(), endDate: text('end_date').notNull(),
  days: real('days').notNull(), year: integer('year').notNull(), note: text('note').notNull().default(''),
  requiredManagerId:text('required_manager_id'), attachmentId:text('attachment_id'),
  status: text('status').notNull().default('pending'), createdAt: text('created_at').notNull(),
  reviewedAt: text('reviewed_at'), reviewerId: text('reviewer_id'), reviewNote: text('review_note').notNull().default('')
});
export const documents = sqliteTable('documents', {
 dataScope:text('data_scope').notNull().default('live'),
  id:text('id').primaryKey(), ownerId:text('owner_id').notNull().references(()=>employees.id),
  name:text('name').notNull(), key:text('object_key').notNull().unique(), category:text('category').notNull(),
  visibility:text('visibility').notNull().default('personal'),folder:text('folder').notNull().default('Unsorted'),expiryDate:text('expiry_date'),pinned:integer('pinned').notNull().default(0), mime:text('mime').notNull(),
  size:integer('size').notNull(), uploadedAt:text('uploaded_at').notNull(), archived:integer('archived').notNull().default(0)
});
export const events = sqliteTable('events', {
 dataScope:text('data_scope').notNull().default('live'),
  id:text('id').primaryKey(), title:text('title').notNull(), date:text('date').notNull(),
  kind:text('kind').notNull(), location:text('location').notNull().default('All locations'),
  createdBy:text('created_by').notNull(), demo:integer('demo').notNull().default(0)
});
export const audit = sqliteTable('audit', {
 dataScope:text('data_scope').notNull().default('live'),
  id:text('id').primaryKey(), actorId:text('actor_id').notNull(), action:text('action').notNull(),
  targetId:text('target_id').notNull(), createdAt:text('created_at').notNull()
});

export const tasks = sqliteTable('tasks', {
 dataScope:text('data_scope').notNull().default('live'),
 id:text('id').primaryKey(),title:text('title').notNull(),assigneeId:text('assignee_id').notNull().references(()=>employees.id),relatedEmployeeId:text('related_employee_id'),workflowId:text('workflow_id'),description:text('description').notNull().default(''),dueDate:text('due_date').notNull(),status:text('status').notNull().default('pending'),createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull(),demo:integer('demo').notNull().default(0)
});
export const entitlements = sqliteTable('entitlements', {
 dataScope:text('data_scope').notNull().default('live'),
 id:text('id').primaryKey(),employeeId:text('employee_id').notNull().references(()=>employees.id),year:integer('year').notNull(),type:text('type').notNull(),total:real('total').notNull(),updatedBy:text('updated_by').notNull(),updatedAt:text('updated_at').notNull()
});

// Sensitive personnel fields never belong in the directory employee projection.
export const employeeProfiles = sqliteTable('employee_profiles', {
 dataScope:text('data_scope').notNull().default('live'),
 employeeId:text('employee_id').primaryKey().references(()=>employees.id),
 legalFirstName:text('legal_first_name').notNull().default(''),legalLastName:text('legal_last_name').notNull().default(''),preferredName:text('preferred_name').notNull().default(''),
 birthDate:text('birth_date').notNull().default(''),gender:text('gender').notNull().default(''),maritalStatus:text('marital_status').notNull().default(''),nationality:text('nationality').notNull().default(''),citizenship:text('citizenship').notNull().default(''),
 personalEmail:text('personal_email').notNull().default(''),personalPhone:text('personal_phone').notNull().default(''),workPhone:text('work_phone').notNull().default(''),workPhonePublic:integer('work_phone_public').notNull().default(0),
 addressLine1:text('address_line1').notNull().default(''),addressLine2:text('address_line2').notNull().default(''),city:text('city').notNull().default(''),state:text('state').notNull().default(''),postalCode:text('postal_code').notNull().default(''),country:text('country').notNull().default(''),
 secondaryAddressLine1:text('secondary_address_line1').notNull().default(''),secondaryAddressLine2:text('secondary_address_line2').notNull().default(''),secondaryCity:text('secondary_city').notNull().default(''),secondaryState:text('secondary_state').notNull().default(''),secondaryPostalCode:text('secondary_postal_code').notNull().default(''),secondaryCountry:text('secondary_country').notNull().default(''),
 linkedin:text('linkedin').notNull().default(''),languages:text('languages').notNull().default(''),bio:text('bio').notNull().default(''),
 employeeNumber:text('employee_number').notNull().default(''),legalEntity:text('legal_entity').notNull().default(''),division:text('division').notNull().default(''),timezone:text('timezone').notNull().default(''),workSchedule:text('work_schedule').notNull().default(''),workArrangement:text('work_arrangement').notNull().default(''),hoursPerDay:real('hours_per_day'),employmentStatus:text('employment_status').notNull().default('Active'),
 probationEnd:text('probation_end').notNull().default(''),contractEnd:text('contract_end').notNull().default(''),exitDate:text('exit_date').notNull().default(''),exitReason:text('exit_reason').notNull().default(''),updatedAt:text('updated_at').notNull()
});
export const emergencyContacts=sqliteTable('emergency_contacts',{
 dataScope:text('data_scope').notNull().default('live'),
 id:text('id').primaryKey(),employeeId:text('employee_id').notNull().references(()=>employees.id),name:text('name').notNull(),relationship:text('relationship').notNull(),phone:text('phone').notNull(),alternatePhone:text('alternate_phone').notNull().default(''),email:text('email').notNull().default(''),address:text('address').notNull().default(''),isPrimary:integer('is_primary').notNull().default(0),priority:integer('priority').notNull().default(1),updatedAt:text('updated_at').notNull()
});
// Deliberately metadata-only: never add full identifier, banking, or tax-number columns.
export const employeeIdentifiers=sqliteTable('employee_identifiers',{
 dataScope:text('data_scope').notNull().default('live'),
 id:text('id').primaryKey(),employeeId:text('employee_id').notNull().references(()=>employees.id),type:text('type').notNull(),country:text('country').notNull(),expiryDate:text('expiry_date').notNull().default(''),status:text('status').notNull().default('Pending'),last4:text('last4').notNull().default(''),updatedAt:text('updated_at').notNull()
});
export const compensationRecords=sqliteTable('compensation_records',{
 dataScope:text('data_scope').notNull().default('live'),
 id:text('id').primaryKey(),employeeId:text('employee_id').notNull().references(()=>employees.id),amount:real('amount').notNull(),currency:text('currency').notNull(),frequency:text('frequency').notNull(),recordType:text('record_type').notNull().default('Salary'),paySchedule:text('pay_schedule').notNull().default(''),overtimeStatus:text('overtime_status').notNull().default(''),effectiveDate:text('effective_date').notNull(),reason:text('reason').notNull(),createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull()
});
export const employmentHistory=sqliteTable('employment_history',{
 dataScope:text('data_scope').notNull().default('live'),
 id:text('id').primaryKey(),employeeId:text('employee_id').notNull().references(()=>employees.id),effectiveDate:text('effective_date').notNull(),reason:text('reason').notNull(),snapshot:text('snapshot').notNull(),createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull()
});
export const educationRecords=sqliteTable('education_records',{
 dataScope:text('data_scope').notNull().default('live'),
 id:text('id').primaryKey(),employeeId:text('employee_id').notNull().references(()=>employees.id),institution:text('institution').notNull(),degree:text('degree').notNull().default(''),fieldOfStudy:text('field_of_study').notNull().default(''),department:text('department').notNull().default(''),graduationDate:text('graduation_date').notNull().default(''),startDate:text('start_date').notNull().default(''),endDate:text('end_date').notNull().default(''),status:text('status').notNull().default('Completed'),notes:text('notes').notNull().default(''),updatedAt:text('updated_at').notNull()
});
export const benefitEnrollments=sqliteTable('benefit_enrollments',{
 dataScope:text('data_scope').notNull().default('live'),
 id:text('id').primaryKey(),employeeId:text('employee_id').notNull().references(()=>employees.id),type:text('type').notNull(),plan:text('plan').notNull(),provider:text('provider').notNull().default(''),coverage:text('coverage').notNull().default(''),cost:real('cost'),currency:text('currency').notNull().default(''),period:text('period').notNull().default(''),status:text('status').notNull(),effectiveDate:text('effective_date').notNull(),endDate:text('end_date').notNull().default(''),notes:text('notes').notNull().default(''),updatedAt:text('updated_at').notNull()
});

export * from './operations-schema';

export * from './import-schema';

export * from './photo-schema';

export * from './auth-schema';
