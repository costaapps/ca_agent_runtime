import type { AgentInputItem } from '@openai/agents';
import type { AgentSessionRecord, AgentSessionRepository, StoredTurnExecution } from '../../src/database/repositories/aiSessionRepository.js';
import type { MemoryRepository } from './memoryRepository.js';

export class MemorySessionRepository implements AgentSessionRepository {
  sessions: AgentSessionRecord[] = [];
  items = new Map<string, AgentInputItem[]>();
  executionUUIDs = new Map<string, string[]>();

  constructor(private readonly executionRepository?: MemoryRepository) {}

  async findByProcessLine(idCompany: number, idProcessLine: number): Promise<AgentSessionRecord | undefined> {
    return this.sessions.find((session) => session.IdCompany === idCompany && session.IdProcessLine === idProcessLine);
  }

  async createSession(data: Omit<AgentSessionRecord, 'IdAIAgentSession'>): Promise<AgentSessionRecord> {
    const session = { ...data, IdAIAgentSession: this.sessions.length + 1 };
    this.sessions.push(session);
    this.items.set(session.SessionUUID, []);
    this.executionUUIDs.set(session.SessionUUID, []);
    return session;
  }

  async touchSession(sessionUUID: string): Promise<void> {
    const session = this.sessions.find((entry) => entry.SessionUUID === sessionUUID);
    if (session) session.LastActivityAt = new Date();
  }

  async closeSession(idCompany: number, idProcessLine: number): Promise<AgentSessionRecord | undefined> {
    const session = await this.findByProcessLine(idCompany, idProcessLine);
    if (session && session.Status === 'OPEN') {
      session.Status = 'CLOSED';
      session.ClosedAt = new Date();
      session.LastActivityAt = new Date();
    }
    return session;
  }

  async getItems(sessionUUID: string, limit?: number): Promise<AgentInputItem[]> {
    const values = [...(this.items.get(sessionUUID) ?? [])];
    return limit === undefined ? values : values.slice(-limit);
  }

  async appendItems(sessionUUID: string, executionUUID: string | undefined, values: AgentInputItem[]): Promise<void> {
    const items = this.items.get(sessionUUID) ?? [];
    items.push(...values);
    this.items.set(sessionUUID, items);
    const executions = this.executionUUIDs.get(sessionUUID) ?? [];
    executions.push(...values.map(() => executionUUID ?? ''));
    this.executionUUIDs.set(sessionUUID, executions);
  }

  async popItem(sessionUUID: string): Promise<AgentInputItem | undefined> {
    return this.items.get(sessionUUID)?.pop();
  }

  async clearItems(sessionUUID: string): Promise<void> {
    this.items.set(sessionUUID, []);
  }

  async findExecutionByTurn(turnUUID: string): Promise<StoredTurnExecution | undefined> {
    const entry = this.executionRepository?.executions.find((execution) => execution.data.TurnUUID === turnUUID);
    if (!entry || !entry.data.TurnUUID) return undefined;
    return {
      IdAIAgentExecution: entry.id,
      ExecutionUUID: entry.data.ExecutionUUID,
      TurnUUID: entry.data.TurnUUID,
      SessionUUID: this.sessions.find((session) => session.IdAIAgentSession === entry.data.IdAIAgentSession)?.SessionUUID ?? null,
      RootAgent: this.sessions.find((session) => session.IdAIAgentSession === entry.data.IdAIAgentSession)?.RootAgent ?? null,
      TurnPayloadHash: entry.data.TurnPayloadHash ?? null,
      Success: entry.final?.Success ?? 'N',
      OutputJSON: entry.final?.OutputJSON ?? null,
      ErrorCode: entry.final?.ErrorCode ?? null,
      ErrorMessage: entry.final?.ErrorMessage ?? null,
      FinishedAt: entry.final?.FinishedAt ?? null,
    };
  }
}
