import {sql} from 'drizzle-orm';
import {sqliteTable,text,integer,uniqueIndex,check,primaryKey} from 'drizzle-orm/sqlite-core';
import {employees} from './schema';
// Provider identities are approved out-of-band. No automatic email or metadata linking.
export const employeeIdentities=sqliteTable('employee_identities',{
 id:text('id').primaryKey(),issuer:text('issuer').notNull(),subject:text('subject').notNull(),
 employeeId:text('employee_id').notNull().references(()=>employees.id),enabled:integer('enabled').notNull().default(0),
 createdAt:text('created_at').notNull(),approvedBy:text('approved_by').notNull(),
},table=>[uniqueIndex('employee_identity_subject').on(table.issuer,table.subject),uniqueIndex('employee_identity_employee').on(table.issuer,table.employeeId)]);
// Contains identifiers and timestamps only. Access/refresh tokens never enter D1.
export const authSessions=sqliteTable('auth_sessions',{
 sessionId:text('session_id').primaryKey(),issuer:text('issuer').notNull(),subject:text('subject').notNull(),
 employeeId:text('employee_id').notNull().references(()=>employees.id),createdAt:integer('created_at').notNull(),lastSeen:integer('last_seen').notNull(),revokedAt:integer('revoked_at'),
});
export const authRateLimits=sqliteTable('auth_rate_limits',{
 key:text('key').primaryKey(),windowStart:integer('window_start').notNull(),attempts:integer('attempts').notNull(),
});
// One-way fingerprints let logout revoke this app even during provider outages.
// They grant no access and are never sent to the browser or external services.
export const authSessionTokens=sqliteTable('auth_session_tokens',{
 tokenHash:text('token_hash').primaryKey(),sessionId:text('session_id').notNull().references(()=>authSessions.sessionId),createdAt:integer('created_at').notNull(),
});

// Transaction assertion: a failed final bootstrap invariant aborts every earlier
// insert in the D1 batch. This singleton contains no account or credential data.
export const qaProvisioningChecks=sqliteTable('qa_provisioning_checks',{
 id:integer('id').primaryKey(),valid:integer('valid').notNull(),
},table=>[check('qa_provisioning_singleton',sql`${table.id}=1`),check('qa_provisioning_complete',sql`${table.valid}=1`)]);

// Per-subject cutoff prevents a pre-reset password login/refresh race from
// registering a usable app session. No credentials or token values are stored.
export const authPasswordResets=sqliteTable('auth_password_resets',{
 issuer:text('issuer').notNull(),subject:text('subject').notNull(),notBefore:integer('not_before').notNull(),locked:integer('locked').notNull().default(0),
},table=>[primaryKey({columns:[table.issuer,table.subject]})]);
