import {sqliteTable,text} from 'drizzle-orm/sqlite-core';
// Source relationships describe reporting only; never grant an application role or approval right.
export const sourceEmployeeLinks=sqliteTable('source_employee_links',{
 sourceId:text('source_id').primaryKey(),employeeId:text('employee_id').notNull().unique(),sourceEmail:text('source_email').notNull(),reviewFlag:text('review_flag').notNull().default(''),directoryPhone:text('directory_phone').notNull().default(''),managerSourceId:text('manager_source_id'),managerName:text('manager_name').notNull().default(''),sourceStatus:text('source_status').notNull().default(''),sourceEmploymentType:text('source_employment_type').notNull().default(''),importedAt:text('imported_at').notNull()
});
export const migrationBatches=sqliteTable('migration_batches',{
 id:text('id').primaryKey(),sourceOrigin:text('source_origin').notNull(),digest:text('digest').notNull(),countsJson:text('counts_json').notNull(),importedAt:text('imported_at').notNull()
});
export const sourceHrSettings=sqliteTable('source_hr_settings',{
 id:text('id').primaryKey(),settingsJson:text('settings_json').notNull(),importedAt:text('imported_at').notNull()
});
