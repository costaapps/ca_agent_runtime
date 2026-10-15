import { index, int, longtext, mysqlTable, char, text, varchar, bigint, datetime, unique } from 'drizzle-orm/mysql-core';

export const aiAgentExecution = mysqlTable('AIAgentExecution', {
  IdAIAgentExecution: bigint('IdAIAgentExecution', { mode: 'number' }).autoincrement().primaryKey(),
  ExecutionUUID: char('ExecutionUUID', { length: 36 }).notNull().unique('UQ_AIAgentExecution_UUID'),
  IdCompany: int('IdCompany'),
  IdChat: int('IdChat'),
  IdProcessLine: int('IdProcessLine'),
  IdProcessLineFlow: int('IdProcessLineFlow'),
  IdAIAgentSession: bigint('IdAIAgentSession', { mode: 'number' }),
  TurnUUID: char('TurnUUID', { length: 36 }),
  TurnInputJSON: longtext('TurnInputJSON'),
  TurnPayloadHash: char('TurnPayloadHash', { length: 64 }),
  RequestedAgent: varchar('RequestedAgent', { length: 250 }).notNull(),
  FinalAgent: varchar('FinalAgent', { length: 250 }),
  Message: longtext('Message'),
  ExpectedOutputJSON: longtext('ExpectedOutputJSON'),
  RuntimeConfigJSON: longtext('RuntimeConfigJSON'),
  Success: char('Success', { length: 1 }).notNull().default('N'),
  OutputJSON: longtext('OutputJSON'),
  ErrorCode: varchar('ErrorCode', { length: 100 }),
  ErrorMessage: text('ErrorMessage'),
  OpenAITraceId: varchar('OpenAITraceId', { length: 100 }),
  StartedAt: datetime('StartedAt', { mode: 'date', fsp: 3 }).notNull(),
  FinishedAt: datetime('FinishedAt', { mode: 'date', fsp: 3 }),
  DurationMs: int('DurationMs'),
}, (table) => ({
  processLineFlow: index('IX_AIAgentExecution_ProcessLineFlow').on(table.IdProcessLineFlow),
  chat: index('IX_AIAgentExecution_Chat').on(table.IdChat, table.StartedAt),
  openAITrace: index('IX_AIAgentExecution_OpenAITraceId').on(table.OpenAITraceId),
  session: index('IX_AIAgentExecution_Session').on(table.IdAIAgentSession),
  companyTurn: unique('UQ_AIAgentExecution_Company_TurnUUID').on(table.IdCompany, table.TurnUUID),
}));

export type AIAgentExecution = typeof aiAgentExecution.$inferSelect;
export type NewAIAgentExecution = typeof aiAgentExecution.$inferInsert;
