import type { AgentRunInput, ExpectedOutput } from '../api/contracts/agentRunInput.js';
import type { ActivationContext, AgentTurnInput, ProcessContext, TurnSource } from '../api/contracts/agentTurnInput.js';
import type { TenantScope } from './TenantScope.js';

export interface RuntimeProcessContext {
  readonly System: Record<string, unknown>;
  readonly Facts: Record<string, unknown>;
  readonly BusinessReferences: Record<string, unknown>;
  readonly CurrentIntent: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface RuntimeExecutionContext {
  readonly ExecutionUUID: string;
  readonly CompanyUUID?: string;
  readonly IdDatabase?: number;
  readonly IdCompany: number;
  readonly IdChat: number;
  readonly IdProcessLine: number;
  readonly IdProcessLineFlow: number | null;
  readonly TurnUUID?: string;
  readonly TurnSource?: TurnSource;
  readonly ProcessContextRevision?: number;
  readonly ActivationUUID?: string;
  readonly SessionUUID?: string;
  readonly ExpectedOutput?: ExpectedOutput;
}

export interface RuntimeContextData {
  readonly Execution: RuntimeExecutionContext;
  readonly ProcessContext: RuntimeProcessContext;
  readonly ActivationContext: ActivationContext | null;
  Resolved: Record<string, unknown>;
}

function freezeProcessContext(value: ProcessContext): RuntimeProcessContext {
  return Object.freeze({
    ...value,
    System: Object.freeze({ ...value.System }),
    Facts: Object.freeze({ ...value.Facts }),
    BusinessReferences: Object.freeze({ ...value.BusinessReferences }),
    CurrentIntent: Object.freeze({ ...value.CurrentIntent }),
  });
}

export function createRuntimeContext(input: AgentRunInput, executionUUID: string, tenant?: TenantScope): RuntimeContextData {
  const execution: RuntimeExecutionContext = Object.freeze({
    ExecutionUUID: executionUUID,
    CompanyUUID: tenant?.CompanyUUID ?? input.CompanyUUID,
    IdDatabase: tenant?.IdDatabase,
    IdCompany: input.IdCompany,
    IdChat: input.IdChat,
    IdProcessLine: input.IdProcessLine,
    IdProcessLineFlow: input.IdProcessLineFlow,
    ExpectedOutput: input.ExpectedOutput,
  });

  return {
    Execution: execution,
    ProcessContext: freezeProcessContext({ System: {}, Facts: {}, BusinessReferences: {}, CurrentIntent: {} }),
    ActivationContext: null,
    Resolved: {},
  };
}

export function createAIDocumentRuntimeContext(
  input: AgentTurnInput,
  executionUUID: string,
  sessionUUID: string,
  tenant?: TenantScope,
): RuntimeContextData {
  const execution: RuntimeExecutionContext = Object.freeze({
    ExecutionUUID: executionUUID,
    CompanyUUID: tenant?.CompanyUUID ?? input.CompanyUUID,
    IdDatabase: tenant?.IdDatabase,
    IdCompany: input.IdCompany,
    IdChat: input.IdChat,
    IdProcessLine: input.IdProcessLine,
    IdProcessLineFlow: null,
    TurnUUID: input.TurnUUID,
    TurnSource: input.TurnSource ?? 'MESSAGE',
    ProcessContextRevision: input.ProcessContextRevision ?? 0,
    ActivationUUID: input.ActivationContext?.ActivationUUID,
    SessionUUID: sessionUUID,
  });

  return {
    Execution: execution,
    ProcessContext: freezeProcessContext(input.ProcessContext ?? { System: {}, Facts: {}, BusinessReferences: {}, CurrentIntent: {} }),
    ActivationContext: input.ActivationContext ?? null,
    Resolved: {},
  };
}
