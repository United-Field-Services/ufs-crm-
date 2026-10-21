import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
// Avatars are private R2 objects, never static/public assets or source URL hotlinks.
export const employeePhotos=sqliteTable('employee_photos',{
 dataScope:text('data_scope').notNull().default('live'),
 employeeId:text('employee_id').primaryKey(),objectKey:text('object_key').notNull().unique(),
 mime:text('mime').notNull(),size:integer('size').notNull(),sha256:text('sha256').notNull(),
 sourceId:text('source_id').notNull().unique(),importedAt:text('imported_at').notNull()
});
