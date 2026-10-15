import type { AgentInputItem, RunContext, Session } from '@openai/agents';
import type { AgentSessionRepository } from '../database/repositories/aiSessionRepository.js';
import type { RuntimeContextData } from '../runtime/RuntimeContext.js';

export class DatabaseAgentSession implements Session {
  readonly acceptsRunContext = true as const;

  constructor(
    private readonly sessionUUID: string,
    private readonly repository: AgentSessionRepository,
    private readonly executionUUID?: string,
  ) {}

  async getSessionId(): Promise<string> {
    return this.sessionUUID;
  }

  async getItems(limit?: number, _runContext?: RunContext<RuntimeContextData>): Promise<AgentInputItem[]> {
    return this.repository.getItems(this.sessionUUID, limit);
  }

  async addItems(items: AgentInputItem[], runContext?: RunContext<RuntimeContextData>): Promise<void> {
    const executionUUID = runContext?.context.Execution.ExecutionUUID ?? this.executionUUID;
    await this.repository.appendItems(this.sessionUUID, executionUUID, items);
  }

  async popItem(_runContext?: RunContext<RuntimeContextData>): Promise<AgentInputItem | undefined> {
    return this.repository.popItem(this.sessionUUID);
  }

  async clearSession(_runContext?: RunContext<RuntimeContextData>): Promise<void> {
    await this.repository.clearItems(this.sessionUUID);
  }
}
