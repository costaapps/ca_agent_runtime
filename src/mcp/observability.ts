import type { RuntimeContextData } from '../runtime/RuntimeContext.js';
import type { ExecutionLogger } from '../tracing/ExecutionLogger.js';

export class McpObservabilityRegistry {
  private readonly loggers = new WeakMap<object, ExecutionLogger>();

  register(context: RuntimeContextData, logger: ExecutionLogger): void {
    this.loggers.set(context, logger);
  }

  unregister(context: RuntimeContextData): void {
    this.loggers.delete(context);
  }

  getLogger(context: RuntimeContextData): ExecutionLogger | undefined {
    return this.loggers.get(context);
  }
}

export class ToolCallTracker {
  private readonly started = new WeakMap<object, Map<string, number[]>>();

  begin(context: object, toolName: string): void {
    const contextCalls = this.started.get(context) ?? new Map<string, number[]>();
    const values = contextCalls.get(toolName) ?? [];
    values.push(Date.now());
    contextCalls.set(toolName, values);
    this.started.set(context, contextCalls);
  }

  end(context: object, toolName: string): number {
    const contextCalls = this.started.get(context) ?? new Map<string, number[]>();
    const values = contextCalls.get(toolName) ?? [];
    const startedAt = values.shift() ?? Date.now();
    if (values.length === 0) contextCalls.delete(toolName);
    return Math.max(0, Date.now() - startedAt);
  }
}
