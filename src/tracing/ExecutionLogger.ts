import type { AiExecutionRepository, ExecutionLogRecord } from '../database/repositories/aiExecutionRepository.js';
import { ExecutionEventTypes, type ExecutionEventType } from './eventTypes.js';
import type { TenantTraceIdentity } from '../runtime/TenantScope.js';

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
  private readonly pendingLifecycleWrites = new Set<Promise<void>>();

  constructor(
    private readonly repository: AiExecutionRepository,
    private readonly executionId: number,
    private readonly tenant?: TenantTraceIdentity,
  ) {}

  async append(event: ExecutionEventType, data: Omit<ExecutionLogRecord, 'Sequence' | 'EventType'> = {}): Promise<void> {
    const record: ExecutionLogRecord = {
      Sequence: this.nextSequence++,
      EventType: event,
      ...data,
    };
    await this.repository.appendLog(this.executionId, record);
  }

  /**
   * Tracks a lifecycle write started from an Agent SDK EventEmitter callback.
   * Node's EventEmitter invokes listeners synchronously and ignores returned
   * promises, so the Runtime must explicitly flush these writes before ending
   * the request (and releasing its tenant database lease).
   */
  trackLifecycleWrite(event: ExecutionEventType, write: Promise<void>): void {
    let trackedWrite!: Promise<void>;
    trackedWrite = write
      .catch(() => this.reportLifecycleWriteFailure(event))
      .finally(() => this.pendingLifecycleWrites.delete(trackedWrite));
    this.pendingLifecycleWrites.add(trackedWrite);
  }

  async flushLifecycleWrites(): Promise<void> {
    while (this.pendingLifecycleWrites.size > 0) {
      await Promise.all([...this.pendingLifecycleWrites]);
    }
  }

  private reportLifecycleWriteFailure(event: ExecutionEventType): void {
    // Do not include the database error: drivers may include SQL, parameters,
    // hosts, or credentials in its message and stack.
    try {
      console.error(JSON.stringify({
        Event: 'EXECUTION_LIFECYCLE_LOG_FAILED',
        LogEvent: event,
        ...(this.tenant ? { CompanyUUID: this.tenant.CompanyUUID, IdDatabase: this.tenant.IdDatabase } : {}),
      }));
    } catch {
      // A diagnostic sink must not turn a best-effort lifecycle log into a
      // failed request or an unhandled rejection.
    }
  }

  runtimeStart(): Promise<void> {
    return this.append(ExecutionEventTypes.RuntimeStart, {
      Status: 'STARTED',
      ...(this.tenant ? { InputJSON: serialize({ Tenant: this.tenant }) } : {}),
    });
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

  runtimeWarning(code: string, warningMessage: string): Promise<void> {
    return this.append(ExecutionEventTypes.RuntimeWarning, {
      Status: 'WARNING',
      ErrorMessage: `${code}: ${warningMessage}`,
    });
  }

  runtimeError(errorCode: string, errorMessage: string, durationMs: number): Promise<void> {
    return this.append(ExecutionEventTypes.RuntimeError, {
      Status: 'ERROR',
      ErrorMessage: `${errorCode}: ${errorMessage}`,
      DurationMs: durationMs,
    });
  }
}
