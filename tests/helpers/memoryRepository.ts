import type { AiExecutionRepository, ExecutionLogRecord, FinishExecutionData } from '../../src/database/repositories/aiExecutionRepository.js';
import type { NewAIAgentExecution } from '../../src/database/schema/aiAgentExecution.js';

export class MemoryRepository implements AiExecutionRepository {
  nextId = 1;
  executions: Array<{ id: number; data: NewAIAgentExecution; final?: FinishExecutionData }> = [];
  logs: Array<{ id: number; data: ExecutionLogRecord }> = [];

  async createExecution(data: NewAIAgentExecution): Promise<number> {
    const id = this.nextId++;
    this.executions.push({ id, data });
    return id;
  }

  async finishExecution(id: number, data: FinishExecutionData): Promise<void> {
    const execution = this.executions.find((entry) => entry.id === id);
    if (execution) execution.final = data;
  }

  async failExecution(id: number, data: FinishExecutionData): Promise<void> {
    const execution = this.executions.find((entry) => entry.id === id);
    if (execution) execution.final = data;
  }

  async appendLog(id: number, data: ExecutionLogRecord): Promise<void> {
    this.logs.push({ id, data });
  }
}
