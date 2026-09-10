import type { AgentRunInput, ExpectedOutput } from '../api/contracts/agentRunInput.js';

export interface RuntimeExecutionContext {
  readonly ExecutionUUID: string;
  readonly IdCompany: number;
  readonly IdChat: number;
  readonly IdProcessLine: number;
  readonly IdProcessLineFlow: number;
  readonly ExpectedOutput: ExpectedOutput;
}

export interface RuntimeContextData {
  readonly Execution: RuntimeExecutionContext;
  Resolved: Record<string, unknown>;
}

export function createRuntimeContext(input: AgentRunInput, executionUUID: string): RuntimeContextData {
  const execution: RuntimeExecutionContext = Object.freeze({
    ExecutionUUID: executionUUID,
    IdCompany: input.IdCompany,
    IdChat: input.IdChat,
    IdProcessLine: input.IdProcessLine,
    IdProcessLineFlow: input.IdProcessLineFlow,
    ExpectedOutput: input.ExpectedOutput,
  });

  return {
    Execution: execution,
    Resolved: {},
  };
}
