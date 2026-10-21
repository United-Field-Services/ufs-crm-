import {sqliteTable,text,integer,uniqueIndex} from 'drizzle-orm/sqlite-core';
export const workflowTemplates=sqliteTable('workflow_templates',{
 dataScope:text('data_scope').notNull().default('live'),id:text('id').primaryKey(),name:text('name').notNull(),kind:text('kind').notNull(),steps:text('steps').notNull(),active:integer('active').notNull().default(1),createdBy:text('created_by').notNull(),updatedAt:text('updated_at').notNull()});
export const workflowRuns=sqliteTable('workflow_runs',{
 dataScope:text('data_scope').notNull().default('live'),id:text('id').primaryKey(),templateId:text('template_id').notNull(),employeeId:text('employee_id').notNull(),name:text('name').notNull(),kind:text('kind').notNull(),startDate:text('start_date').notNull(),createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull()});
export const assets=sqliteTable('assets',{
 dataScope:text('data_scope').notNull().default('live'),id:text('id').primaryKey(),name:text('name').notNull(),category:text('category').notNull(),tag:text('tag').notNull(),serial:text('serial').notNull().default(''),status:text('status').notNull().default('available'),assignedTo:text('assigned_to'),assignedAt:text('assigned_at'),returnDue:text('return_due'),notes:text('notes').notNull().default(''),createdBy:text('created_by').notNull(),updatedAt:text('updated_at').notNull()},table=>[uniqueIndex('assets_scope_tag_unique').on(table.dataScope,table.tag)]);
export const assetHistory=sqliteTable('asset_history',{
 dataScope:text('data_scope').notNull().default('live'),id:text('id').primaryKey(),assetId:text('asset_id').notNull(),employeeId:text('employee_id'),action:text('action').notNull(),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull()});
export const announcements=sqliteTable('announcements',{
 dataScope:text('data_scope').notNull().default('live'),id:text('id').primaryKey(),title:text('title').notNull(),body:text('body').notNull(),category:text('category').notNull().default('Company news'),status:text('status').notNull().default('draft'),pinned:integer('pinned').notNull().default(0),createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull(),publishedAt:text('published_at')});
export const announcementReads=sqliteTable('announcement_reads',{
 dataScope:text('data_scope').notNull().default('live'),id:text('id').primaryKey(),announcementId:text('announcement_id').notNull(),employeeId:text('employee_id').notNull(),readAt:text('read_at').notNull()});
export const timeEntries=sqliteTable('time_entries',{
 dataScope:text('data_scope').notNull().default('live'),id:text('id').primaryKey(),employeeId:text('employee_id').notNull(),date:text('date').notNull(),minutes:integer('minutes').notNull(),project:text('project').notNull().default(''),notes:text('notes').notNull().default(''),status:text('status').notNull().default('draft'),requiredManagerId:text('required_manager_id'),reviewNote:text('review_note').notNull().default(''),reviewedBy:text('reviewed_by'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()});
export const documentAcknowledgements=sqliteTable('document_acknowledgements',{
 dataScope:text('data_scope').notNull().default('live'),id:text('id').primaryKey(),documentId:text('document_id').notNull(),employeeId:text('employee_id').notNull(),acknowledgedAt:text('acknowledged_at').notNull()});
