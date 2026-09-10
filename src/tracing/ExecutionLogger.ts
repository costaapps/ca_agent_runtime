import type { AiExecutionRepository, ExecutionLogRecord } from '../database/repositories/aiExecutionRepository.js';
import { ExecutionEventTypes, type ExecutionEventType } from './eventTypes.js';

function serialize(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ value: '[unserializable]' });
  }
}

export class ExecutionLogger {
  private nextSequence = 1;

  constructor(
    private readonly repository: AiExecutionRepository,
    private readonly executionId: number,
  ) {}

  async append(event: ExecutionEventType, data: Omit<ExecutionLogRecord, 'Sequence' | 'EventType'> = {}): Promise<void> {
    const record: ExecutionLogRecord = {
      Sequence: this.nextSequence++,
      EventType: event,
      ...data,
    };
    await this.repository.appendLog(this.executionId, record);
  }

  runtimeStart(): Promise<void> {
    return this.append(ExecutionEventTypes.RuntimeStart, { Status: 'STARTED' });
  }

  agentStart(agentName: string): Promise<void> {
    return this.append(ExecutionEventTypes.AgentStart, { AgentName: agentName, Status: 'STARTED' });
  }

  handoff(fromAgent: string, targetAgent: string, reason: string): Promise<void> {
    return this.append(ExecutionEventTypes.Handoff, {
      AgentName: fromAgent,
      TargetAgentName: targetAgent,
      InputJSON: serialize({ Reason: reason }),
      Status: 'COMPLETED',
    });
  }

  toolCall(toolName: string, input: unknown): Promise<void> {
    return this.append(ExecutionEventTypes.McpToolCall, {
      ToolName: toolName,
      InputJSON: serialize(input),
      Status: 'STARTED',
    });
  }

  toolResult(toolName: string, output: unknown, durationMs: number, status = 'COMPLETED', errorMessage?: string): Promise<void> {
    return this.append(ExecutionEventTypes.McpToolResult, {
      ToolName: toolName,
      OutputJSON: serialize(output),
      Status: status,
      DurationMs: durationMs,
      ErrorMessage: errorMessage,
    });
  }

  agentOutput(agentName: string, output: unknown): Promise<void> {
    return this.append(ExecutionEventTypes.AgentOutput, {
      AgentName: agentName,
      OutputJSON: serialize(output),
      Status: 'COMPLETED',
    });
  }

  runtimeEnd(durationMs: number): Promise<void> {
    return this.append(ExecutionEventTypes.RuntimeEnd, { Status: 'COMPLETED', DurationMs: durationMs });
  }

  runtimeError(errorCode: string, errorMessage: string, durationMs: number): Promise<void> {
    return this.append(ExecutionEventTypes.RuntimeError, {
      Status: 'ERROR',
      ErrorMessage: `${errorCode}: ${errorMessage}`,
      DurationMs: durationMs,
    });
  }
}
