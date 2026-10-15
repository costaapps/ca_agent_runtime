import { and, asc, desc, eq, exists, sql } from 'drizzle-orm';
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
  AgentConfigurationRevision: number | null;
  AgentConfigurationJSON: string | null;
  KnowledgeConfigurationJSON: string | null;
  Status: AgentSessionStatus;
  StartedAt: Date;
  LastActivityAt: Date;
  ClosedAt: Date | null;
}

export interface StoredTurnExecution {
  IdAIAgentExecution: number;
  ExecutionUUID: string;
  TurnUUID: string;
  SessionUUID: string | null;
  RootAgent: string | null;
  TurnPayloadHash: string | null;
  Success: 'Y' | 'N';
  OutputJSON: string | null;
  ErrorCode: string | null;
  ErrorMessage: string | null;
  FinishedAt: Date | null;
}

export interface AgentSessionRepository {
  findByProcessLine(idProcessLine: number): Promise<AgentSessionRecord | undefined>;
  createSession(data: Omit<AgentSessionRecord, 'IdAIAgentSession'>): Promise<AgentSessionRecord>;
  touchSession(sessionUUID: string): Promise<void>;
  closeSession(idProcessLine: number): Promise<AgentSessionRecord | undefined>;
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
  constructor(
    private readonly db: RuntimeDatabase,
    private readonly idCompany: number,
  ) {
    if (!Number.isSafeInteger(idCompany) || idCompany <= 0) {
      throw new Error('IdCompany do repository deve ser um inteiro positivo.');
    }
  }

  async findByProcessLine(idProcessLine: number): Promise<AgentSessionRecord | undefined> {
    const [row] = await this.db.select().from(aiAgentSession).where(and(
      eq(aiAgentSession.IdCompany, this.idCompany),
      eq(aiAgentSession.IdProcessLine, idProcessLine),
    )).limit(1);
    return row ? toSessionRecord(row) : undefined;
  }

  async createSession(data: Omit<AgentSessionRecord, 'IdAIAgentSession'>): Promise<AgentSessionRecord> {
    this.assertCompany(data.IdCompany);
    let result;
    try {
      result = await this.db.insert(aiAgentSession).values({
        SessionUUID: data.SessionUUID,
        IdCompany: this.idCompany,
        IdChat: data.IdChat,
        IdProcessLine: data.IdProcessLine,
        RootAgent: data.RootAgent,
        AgentConfigurationRevision: data.AgentConfigurationRevision,
        AgentConfigurationJSON: data.AgentConfigurationJSON,
        KnowledgeConfigurationJSON: data.KnowledgeConfigurationJSON,
        Status: data.Status,
        StartedAt: data.StartedAt,
        LastActivityAt: data.LastActivityAt,
        ClosedAt: data.ClosedAt,
      });
    } catch (error) {
      const existing = await this.findByProcessLine(data.IdProcessLine);
      if (existing) return existing;
      throw error;
    }
    const id = Number(result[0].insertId);
    const [row] = await this.db.select().from(aiAgentSession).where(and(
      eq(aiAgentSession.IdAIAgentSession, id),
      eq(aiAgentSession.IdCompany, this.idCompany),
    )).limit(1);
    if (!row) throw new Error('AIAgentSession criada mas não encontrada.');
    return toSessionRecord(row);
  }

  async touchSession(sessionUUID: string): Promise<void> {
    await this.db.update(aiAgentSession)
      .set({ LastActivityAt: new Date() })
      .where(and(
        eq(aiAgentSession.SessionUUID, sessionUUID),
        eq(aiAgentSession.IdCompany, this.idCompany),
      ));
  }

  async closeSession(idProcessLine: number): Promise<AgentSessionRecord | undefined> {
    const existing = await this.findByProcessLine(idProcessLine);
    if (!existing) return undefined;
    if (existing.Status === 'OPEN') {
      await this.db.update(aiAgentSession)
        .set({ Status: 'CLOSED', ClosedAt: new Date(), LastActivityAt: new Date() })
        .where(and(
          eq(aiAgentSession.IdCompany, this.idCompany),
          eq(aiAgentSession.IdProcessLine, idProcessLine),
        ));
    }
    return this.findByProcessLine(idProcessLine);
  }

  async getItems(sessionUUID: string, limit?: number): Promise<AgentInputItem[]> {
    const session = await this.findSessionByUUID(sessionUUID);
    if (!session) return [];
    const query = this.db.select().from(aiAgentSessionItem)
      .where(this.sessionItemsWhere(session.IdAIAgentSession))
      .orderBy(limit === undefined ? asc(aiAgentSessionItem.Sequence) : desc(aiAgentSessionItem.Sequence));
    const rows = limit === undefined ? await query : (await query.limit(limit)).reverse();
    return rows.flatMap((row) => this.parseItem(row.ItemJSON));
  }

  async appendItems(sessionUUID: string, executionUUID: string | undefined, items: AgentInputItem[]): Promise<void> {
    if (items.length === 0) return;
    const session = await this.findSessionByUUID(sessionUUID);
    if (!session) throw new Error(`Session '${sessionUUID}' não encontrada.`);
    if (executionUUID) await this.assertExecutionOwnership(executionUUID);
    const [last] = await this.db.select({ Sequence: aiAgentSessionItem.Sequence })
      .from(aiAgentSessionItem)
      .where(this.sessionItemsWhere(session.IdAIAgentSession))
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
      .where(this.sessionItemsWhere(session.IdAIAgentSession))
      .orderBy(desc(aiAgentSessionItem.Sequence))
      .limit(1);
    if (!row) return undefined;
    await this.db.delete(aiAgentSessionItem).where(and(
      eq(aiAgentSessionItem.IdAIAgentSessionItem, row.IdAIAgentSessionItem),
      eq(aiAgentSessionItem.IdAIAgentSession, session.IdAIAgentSession),
      this.sessionOwnershipExists(session.IdAIAgentSession),
    ));
    return this.parseItem(row.ItemJSON)[0];
  }

  async clearItems(sessionUUID: string): Promise<void> {
    const session = await this.findSessionByUUID(sessionUUID);
    if (session) await this.db.delete(aiAgentSessionItem).where(this.sessionItemsWhere(session.IdAIAgentSession));
  }

  async findExecutionByTurn(turnUUID: string): Promise<StoredTurnExecution | undefined> {
    const [row] = await this.db.select({
      IdAIAgentExecution: aiAgentExecution.IdAIAgentExecution,
      ExecutionUUID: aiAgentExecution.ExecutionUUID,
      TurnUUID: aiAgentExecution.TurnUUID,
      SessionUUID: aiAgentSession.SessionUUID,
      RootAgent: aiAgentSession.RootAgent,
      TurnPayloadHash: aiAgentExecution.TurnPayloadHash,
      Success: aiAgentExecution.Success,
      OutputJSON: aiAgentExecution.OutputJSON,
      ErrorCode: aiAgentExecution.ErrorCode,
      ErrorMessage: aiAgentExecution.ErrorMessage,
      FinishedAt: aiAgentExecution.FinishedAt,
    }).from(aiAgentExecution)
      .leftJoin(aiAgentSession, and(
        eq(aiAgentSession.IdAIAgentSession, aiAgentExecution.IdAIAgentSession),
        eq(aiAgentSession.IdCompany, this.idCompany),
      ))
      .where(and(
        eq(aiAgentExecution.IdCompany, this.idCompany),
        eq(aiAgentExecution.TurnUUID, turnUUID),
      )).limit(1);
    if (!row || !row.TurnUUID) return undefined;
    return { ...row, TurnUUID: row.TurnUUID, Success: row.Success as 'Y' | 'N' };
  }

  private async findSessionByUUID(sessionUUID: string): Promise<typeof aiAgentSession.$inferSelect | undefined> {
    const [row] = await this.db.select().from(aiAgentSession).where(and(
      eq(aiAgentSession.SessionUUID, sessionUUID),
      eq(aiAgentSession.IdCompany, this.idCompany),
    )).limit(1);
    return row;
  }

  private sessionItemsWhere(idAIAgentSession: number) {
    return and(
      eq(aiAgentSessionItem.IdAIAgentSession, idAIAgentSession),
      this.sessionOwnershipExists(idAIAgentSession),
    );
  }

  private sessionOwnershipExists(idAIAgentSession: number) {
    return exists(this.db.select({ one: sql`1` })
      .from(aiAgentSession)
      .where(and(
        eq(aiAgentSession.IdAIAgentSession, idAIAgentSession),
        eq(aiAgentSession.IdCompany, this.idCompany),
      )));
  }

  private async assertExecutionOwnership(executionUUID: string): Promise<void> {
    const [execution] = await this.db.select({ id: aiAgentExecution.IdAIAgentExecution })
      .from(aiAgentExecution)
      .where(and(
        eq(aiAgentExecution.ExecutionUUID, executionUUID),
        eq(aiAgentExecution.IdCompany, this.idCompany),
      ))
      .limit(1);
    if (!execution) {
      throw new Error('A execução não pertence à empresa do repository.');
    }
  }

  private assertCompany(idCompany: number): void {
    if (idCompany !== this.idCompany) {
      throw new Error('A sessão pertence a uma empresa diferente do escopo do repository.');
    }
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
