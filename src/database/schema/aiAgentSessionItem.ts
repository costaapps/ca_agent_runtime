import { bigint, char, datetime, index, int, longtext, mysqlTable, unique } from 'drizzle-orm/mysql-core';

export const aiAgentSessionItem = mysqlTable('AIAgentSessionItem', {
  IdAIAgentSessionItem: bigint('IdAIAgentSessionItem', { mode: 'number' }).autoincrement().primaryKey(),
  IdAIAgentSession: bigint('IdAIAgentSession', { mode: 'number' }).notNull(),
  Sequence: int('Sequence').notNull(),
  ExecutionUUID: char('ExecutionUUID', { length: 36 }),
  ItemJSON: longtext('ItemJSON').notNull(),
  CreateDateTime: datetime('CreateDateTime', { mode: 'date', fsp: 3 }).notNull(),
}, (table) => ({
  sessionSequence: unique('UQ_AIAgentSessionItem_SessionSequence').on(table.IdAIAgentSession, table.Sequence),
  session: index('IX_AIAgentSessionItem_Session').on(table.IdAIAgentSession, table.Sequence),
  execution: index('IX_AIAgentSessionItem_Execution').on(table.ExecutionUUID),
}));

export type AIAgentSessionItem = typeof aiAgentSessionItem.$inferSelect;
export type NewAIAgentSessionItem = typeof aiAgentSessionItem.$inferInsert;
