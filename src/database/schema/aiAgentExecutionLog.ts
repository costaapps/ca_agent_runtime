import { index, int, longtext, mysqlTable, bigint, datetime, text, varchar } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const aiAgentExecutionLog = mysqlTable('AIAgentExecutionLog', {
  IdAIAgentExecutionLog: bigint('IdAIAgentExecutionLog', { mode: 'number' }).autoincrement().primaryKey(),
  IdAIAgentExecution: bigint('IdAIAgentExecution', { mode: 'number' }).notNull(),
  Sequence: int('Sequence').notNull(),
  EventType: varchar('EventType', { length: 50 }).notNull(),
  AgentName: varchar('AgentName', { length: 250 }),
  TargetAgentName: varchar('TargetAgentName', { length: 250 }),
  ToolName: varchar('ToolName', { length: 250 }),
  InputJSON: longtext('InputJSON'),
  OutputJSON: longtext('OutputJSON'),
  Status: varchar('Status', { length: 50 }),
  DurationMs: int('DurationMs'),
  ErrorMessage: text('ErrorMessage'),
  CreateDateTime: datetime('CreateDateTime', { mode: 'date', fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, (table) => ({
  execution: index('IX_AIAgentExecutionLog_Execution').on(table.IdAIAgentExecution, table.Sequence),
}));

export type AIAgentExecutionLog = typeof aiAgentExecutionLog.$inferSelect;
export type NewAIAgentExecutionLog = typeof aiAgentExecutionLog.$inferInsert;
