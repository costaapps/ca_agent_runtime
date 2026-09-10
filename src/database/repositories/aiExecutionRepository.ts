import { eq } from 'drizzle-orm';
import type { RuntimeDatabase } from '../connection.js';
import { aiAgentExecution, aiAgentExecutionLog, type NewAIAgentExecution, type NewAIAgentExecutionLog } from '../schema/index.js';

export interface ExecutionLogRecord {
  Sequence: number;
  EventType: string;
  AgentName?: string;
  TargetAgentName?: string;
  ToolName?: string;
  InputJSON?: string;
  OutputJSON?: string;
  Status?: string;
  DurationMs?: number;
  ErrorMessage?: string;
}

export interface FinishExecutionData {
  FinalAgent?: string;
  Success: 'Y' | 'N';
  OutputJSON?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  FinishedAt: Date;
  DurationMs: number;
}

export interface AiExecutionRepository {
  createExecution(data: NewAIAgentExecution): Promise<number>;
  finishExecution(id: number, data: FinishExecutionData): Promise<void>;
  failExecution(id: number, data: FinishExecutionData): Promise<void>;
  appendLog(id: number, data: ExecutionLogRecord): Promise<void>;
}

export class DrizzleAiExecutionRepository implements AiExecutionRepository {
  constructor(private readonly db: RuntimeDatabase) {}

  async createExecution(data: NewAIAgentExecution): Promise<number> {
    const result = await this.db.insert(aiAgentExecution).values(data);
    return Number(result[0].insertId);
  }

  async finishExecution(id: number, data: FinishExecutionData): Promise<void> {
    await this.db.update(aiAgentExecution).set(data).where(eq(aiAgentExecution.IdAIAgentExecution, id));
  }

  async failExecution(id: number, data: FinishExecutionData): Promise<void> {
    await this.db.update(aiAgentExecution).set({ ...data, Success: 'N' }).where(eq(aiAgentExecution.IdAIAgentExecution, id));
  }

  async appendLog(id: number, data: ExecutionLogRecord): Promise<void> {
    const row: NewAIAgentExecutionLog = {
      IdAIAgentExecution: id,
      Sequence: data.Sequence,
      EventType: data.EventType,
      AgentName: data.AgentName,
      TargetAgentName: data.TargetAgentName,
      ToolName: data.ToolName,
      InputJSON: data.InputJSON,
      OutputJSON: data.OutputJSON,
      Status: data.Status,
      DurationMs: data.DurationMs,
      ErrorMessage: data.ErrorMessage,
    };
    await this.db.insert(aiAgentExecutionLog).values(row);
  }
}
