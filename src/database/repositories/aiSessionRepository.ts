import { and, asc, desc, eq } from 'drizzle-orm';
import type { AgentInputItem } from '@openai/agents';
import type { RuntimeDatabase } from '../connection.js';
import { aiAgentExecution, aiAgentSession, aiAgentSessionItem } from '../schema/index.js';

export type AgentSessionStatus = 'OPEN' | 'CLOSED';

export interface AgentSessionRecord {
  IdAIAgentSession: number;
  SessionUUID: string;
  IdCompany: number;
  IdChat: number;
  IdProcessLine: number;
  RootAgent: string;
  Status: AgentSessionStatus;
  StartedAt: Date;
  LastActivityAt: Date;
  ClosedAt: Date | null;
}

export interface StoredTurnExecution {
  IdAIAgentExecution: number;
  ExecutionUUID: string;
  TurnUUID: string;
  TurnPayloadHash: string | null;
  Success: 'Y' | 'N';
  OutputJSON: string | null;
  ErrorCode: string | null;
  ErrorMessage: string | null;
  FinishedAt: Date | null;
}

export interface AgentSessionRepository {
  findByProcessLine(idCompany: number, idProcessLine: number): Promise<AgentSessionRecord | undefined>;
  createSession(data: Omit<AgentSessionRecord, 'IdAIAgentSession'>): Promise<AgentSessionRecord>;
  touchSession(sessionUUID: string): Promise<void>;
  closeSession(idCompany: number, idProcessLine: number): Promise<AgentSessionRecord | undefined>;
  getItems(sessionUUID: string, limit?: number): Promise<AgentInputItem[]>;
  appendItems(sessionUUID: string, executionUUID: string | undefined, items: AgentInputItem[]): Promise<void>;
  popItem(sessionUUID: string): Promise<AgentInputItem | undefined>;
  clearItems(sessionUUID: string): Promise<void>;
  findExecutionByTurn(turnUUID: string): Promise<StoredTurnExecution | undefined>;
}

function toSessionRecord(row: typeof aiAgentSession.$inferSelect): AgentSessionRecord {
  return {
    ...row,
    Status: row.Status as AgentSessionStatus,
    ClosedAt: row.ClosedAt ?? null,
  };
}

export class DrizzleAgentSessionRepository implements AgentSessionRepository {
  constructor(private readonly db: RuntimeDatabase) {}

  async findByProcessLine(idCompany: number, idProcessLine: number): Promise<AgentSessionRecord | undefined> {
    const [row] = await this.db.select().from(aiAgentSession).where(and(
      eq(aiAgentSession.IdCompany, idCompany),
      eq(aiAgentSession.IdProcessLine, idProcessLine),
    )).limit(1);
    return row ? toSessionRecord(row) : undefined;
  }

  async createSession(data: Omit<AgentSessionRecord, 'IdAIAgentSession'>): Promise<AgentSessionRecord> {
    let result;
    try {
      result = await this.db.insert(aiAgentSession).values({
        SessionUUID: data.SessionUUID,
        IdCompany: data.IdCompany,
        IdChat: data.IdChat,
        IdProcessLine: data.IdProcessLine,
        RootAgent: data.RootAgent,
        Status: data.Status,
        StartedAt: data.StartedAt,
        LastActivityAt: data.LastActivityAt,
        ClosedAt: data.ClosedAt,
      });
    } catch (error) {
      const existing = await this.findByProcessLine(data.IdCompany, data.IdProcessLine);
      if (existing) return existing;
      throw error;
    }
    const id = Number(result[0].insertId);
    const [row] = await this.db.select().from(aiAgentSession).where(eq(aiAgentSession.IdAIAgentSession, id)).limit(1);
    if (!row) throw new Error('AIAgentSession criada mas não encontrada.');
    return toSessionRecord(row);
  }

  async touchSession(sessionUUID: string): Promise<void> {
    await this.db.update(aiAgentSession)
      .set({ LastActivityAt: new Date() })
      .where(eq(aiAgentSession.SessionUUID, sessionUUID));
  }

  async closeSession(idCompany: number, idProcessLine: number): Promise<AgentSessionRecord | undefined> {
    const existing = await this.findByProcessLine(idCompany, idProcessLine);
    if (!existing) return undefined;
    if (existing.Status === 'OPEN') {
      await this.db.update(aiAgentSession)
        .set({ Status: 'CLOSED', ClosedAt: new Date(), LastActivityAt: new Date() })
        .where(and(
          eq(aiAgentSession.IdCompany, idCompany),
          eq(aiAgentSession.IdProcessLine, idProcessLine),
        ));
    }
    return this.findByProcessLine(idCompany, idProcessLine);
  }

  async getItems(sessionUUID: string, limit?: number): Promise<AgentInputItem[]> {
    const session = await this.findSessionByUUID(sessionUUID);
    if (!session) return [];
    const query = this.db.select().from(aiAgentSessionItem)
      .where(eq(aiAgentSessionItem.IdAIAgentSession, session.IdAIAgentSession))
      .orderBy(limit === undefined ? asc(aiAgentSessionItem.Sequence) : desc(aiAgentSessionItem.Sequence));
    const rows = limit === undefined ? await query : (await query.limit(limit)).reverse();
    return rows.flatMap((row) => this.parseItem(row.ItemJSON));
  }

  async appendItems(sessionUUID: string, executionUUID: string | undefined, items: AgentInputItem[]): Promise<void> {
    if (items.length === 0) return;
    const session = await this.findSessionByUUID(sessionUUID);
    if (!session) throw new Error(`Session '${sessionUUID}' não encontrada.`);
    const [last] = await this.db.select({ Sequence: aiAgentSessionItem.Sequence })
      .from(aiAgentSessionItem)
      .where(eq(aiAgentSessionItem.IdAIAgentSession, session.IdAIAgentSession))
      .orderBy(desc(aiAgentSessionItem.Sequence))
      .limit(1);
    const firstSequence = (last?.Sequence ?? 0) + 1;
    await this.db.insert(aiAgentSessionItem).values(items.map((item, index) => ({
      IdAIAgentSession: session.IdAIAgentSession,
      Sequence: firstSequence + index,
      ExecutionUUID: executionUUID,
      ItemJSON: JSON.stringify(item),
      CreateDateTime: new Date(),
    })));
    await this.touchSession(sessionUUID);
  }

  async popItem(sessionUUID: string): Promise<AgentInputItem | undefined> {
    const session = await this.findSessionByUUID(sessionUUID);
    if (!session) return undefined;
    const [row] = await this.db.select().from(aiAgentSessionItem)
      .where(eq(aiAgentSessionItem.IdAIAgentSession, session.IdAIAgentSession))
      .orderBy(desc(aiAgentSessionItem.Sequence))
      .limit(1);
    if (!row) return undefined;
    await this.db.delete(aiAgentSessionItem).where(eq(aiAgentSessionItem.IdAIAgentSessionItem, row.IdAIAgentSessionItem));
    return this.parseItem(row.ItemJSON)[0];
  }

  async clearItems(sessionUUID: string): Promise<void> {
    const session = await this.findSessionByUUID(sessionUUID);
    if (session) await this.db.delete(aiAgentSessionItem).where(eq(aiAgentSessionItem.IdAIAgentSession, session.IdAIAgentSession));
  }

  async findExecutionByTurn(turnUUID: string): Promise<StoredTurnExecution | undefined> {
    const [row] = await this.db.select({
      IdAIAgentExecution: aiAgentExecution.IdAIAgentExecution,
      ExecutionUUID: aiAgentExecution.ExecutionUUID,
      TurnUUID: aiAgentExecution.TurnUUID,
      TurnPayloadHash: aiAgentExecution.TurnPayloadHash,
      Success: aiAgentExecution.Success,
      OutputJSON: aiAgentExecution.OutputJSON,
      ErrorCode: aiAgentExecution.ErrorCode,
      ErrorMessage: aiAgentExecution.ErrorMessage,
      FinishedAt: aiAgentExecution.FinishedAt,
    }).from(aiAgentExecution).where(eq(aiAgentExecution.TurnUUID, turnUUID)).limit(1);
    if (!row || !row.TurnUUID) return undefined;
    return { ...row, TurnUUID: row.TurnUUID, Success: row.Success as 'Y' | 'N' };
  }

  private async findSessionByUUID(sessionUUID: string): Promise<typeof aiAgentSession.$inferSelect | undefined> {
    const [row] = await this.db.select().from(aiAgentSession).where(eq(aiAgentSession.SessionUUID, sessionUUID)).limit(1);
    return row;
  }

  private parseItem(itemJSON: string): AgentInputItem[] {
    try {
      const value = JSON.parse(itemJSON) as AgentInputItem;
      return [value];
    } catch {
      return [];
    }
  }
}
