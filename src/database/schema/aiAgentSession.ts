import { index, int, bigint, char, datetime, mysqlTable, unique, varchar, longtext } from 'drizzle-orm/mysql-core';

export const aiAgentSession = mysqlTable('AIAgentSession', {
  IdAIAgentSession: bigint('IdAIAgentSession', { mode: 'number' }).autoincrement().primaryKey(),
  SessionUUID: char('SessionUUID', { length: 36 }).notNull().unique('UQ_AIAgentSession_UUID'),
  IdCompany: int('IdCompany').notNull(),
  IdChat: int('IdChat').notNull(),
  IdProcessLine: int('IdProcessLine').notNull(),
  RootAgent: varchar('RootAgent', { length: 250 }).notNull(),
  AgentConfigurationRevision: int('AgentConfigurationRevision'),
  AgentConfigurationJSON: longtext('AgentConfigurationJSON'),
  Status: varchar('Status', { length: 20 }).notNull(),
  StartedAt: datetime('StartedAt', { mode: 'date', fsp: 3 }).notNull(),
  LastActivityAt: datetime('LastActivityAt', { mode: 'date', fsp: 3 }).notNull(),
  ClosedAt: datetime('ClosedAt', { mode: 'date', fsp: 3 }),
}, (table) => ({
  processLine: unique('UQ_AIAgentSession_CompanyProcessLine').on(table.IdCompany, table.IdProcessLine),
  status: index('IX_AIAgentSession_Status').on(table.Status),
}));

export type AIAgentSession = typeof aiAgentSession.$inferSelect;
export type NewAIAgentSession = typeof aiAgentSession.$inferInsert;
