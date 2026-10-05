import { randomUUID } from 'node:crypto';
import { ModelBehaviorError } from '@openai/agents';
import { ZodError } from 'zod';
import type { FlowAssistInput } from '../api/contracts/flowAssistInput.js';
import { FlowAssistAgentOutputSchema, type FlowAssistAgentOutput, type FlowAssistOutput } from '../api/contracts/flowAssistOutput.js';
import { AgentRegistry } from '../agents/AgentRegistry.js';
import { flowAssistInputItems } from '../agents/flow-assist/flowAssistAgent.js';
import type { AiExecutionRepository } from '../database/repositories/aiExecutionRepository.js';
import { ErrorCodes } from '../errors/errorCodes.js';
import { RuntimeError, asRuntimeError } from '../errors/RuntimeError.js';
import type { OpenAIRunner } from '../openai/runner.js';
import { createOpenAITraceId } from '../openai/tracing.js';
import { ExecutionLogger } from '../tracing/ExecutionLogger.js';
import type { RuntimeContextData } from './RuntimeContext.js';

export interface FlowAssistRuntimeOptions {
  repository: AiExecutionRepository;
  registry: AgentRegistry;
  runner: OpenAIRunner;
  model: string;
  tracingEnabled: boolean;
  traceIncludeSensitiveData: boolean;
}

export interface FlowAssistRuntimeResult {
  statusCode: 200 | 422 | 500;
  response: FlowAssistOutput;
}

export function validateFlowAssistProposals(output: unknown, input: FlowAssistInput): FlowAssistAgentOutput {
  const parsed = FlowAssistAgentOutputSchema.safeParse(output);
  if (!parsed.success) throw new RuntimeError(ErrorCodes.InvalidAgentOutput, 'Output do Agent Assist inválido.');
  const targetIds = new Set(input.Targets.map((target) => target.IdProcessLineFlow));
  const proposalIds = parsed.data.Proposals.map((proposal) => proposal.IdProcessLineFlow);
  if (proposalIds.length !== targetIds.size || new Set(proposalIds).size !== proposalIds.length || proposalIds.some((id) => !targetIds.has(id))) {
    throw new RuntimeError(ErrorCodes.InvalidAgentOutput, 'Proposals deve conter exatamente uma entrada para cada Target.');
  }
  return parsed.data;
}

export class FlowAssistRuntime {
  constructor(private readonly options: FlowAssistRuntimeOptions) {}

  async runFlowAssist(input: FlowAssistInput): Promise<FlowAssistRuntimeResult> {
    const executionUUID = randomUUID();
    const traceId = createOpenAITraceId();
    const startedAt = Date.now();
    const duration = () => Math.max(0, Date.now() - startedAt);
    let executionId: number | undefined;
    let logger: ExecutionLogger | undefined;
    const persist = async <T>(operation: () => Promise<T>): Promise<T> => {
      try { return await operation(); } catch (error) { throw asRuntimeError(error, ErrorCodes.PersistenceError); }
    };
    try {
      try {
        executionId = await this.options.repository.createExecution({
          ExecutionUUID: executionUUID,
          RequestedAgent: input.Agent,
          IdCompany: input.IdCompany,
          IdChat: input.IdChat,
          IdProcessLine: input.IdProcessLine,
          IdProcessLineFlow: input.IdProcessLineFlow,
          Message: JSON.stringify(input.Messages),
          RuntimeConfigJSON: JSON.stringify({ Mode: 'FLOW_ASSIST', Model: this.options.model, TracingEnabled: this.options.tracingEnabled }),
          Success: 'N',
          OpenAITraceId: traceId,
          StartedAt: new Date(startedAt),
        });
      } catch (error) { throw asRuntimeError(error, ErrorCodes.PersistenceError); }

      logger = new ExecutionLogger(this.options.repository, executionId);
      await persist(() => logger!.runtimeStart());
      const agent = this.options.registry.buildFlowAssist(input.Agent, this.options.model);
      const context: RuntimeContextData = {
        Execution: Object.freeze({ ExecutionUUID: executionUUID, IdCompany: input.IdCompany, IdChat: input.IdChat, IdProcessLine: input.IdProcessLine, IdProcessLineFlow: input.IdProcessLineFlow }),
        ProcessContext: Object.freeze({ System: {}, Facts: {}, BusinessReferences: {}, CurrentIntent: {} }),
        ActivationContext: null,
        Resolved: {},
      };
      await persist(() => logger!.agentStart(agent.name));
      const result = await this.options.runner.run(agent, flowAssistInputItems(input), context, {
        enabled: this.options.tracingEnabled,
        includeSensitiveData: this.options.traceIncludeSensitiveData,
        model: this.options.model,
        executionUUID,
        idChat: input.IdChat,
        idProcessLine: input.IdProcessLine,
        idProcessLineFlow: input.IdProcessLineFlow,
        traceId,
      }).catch((error: unknown) => {
        // The SDK parses outputType before returning finalOutput. Preserve the
        // same protocol error when validation happens there (also redacted).
        if (error instanceof ZodError || error instanceof ModelBehaviorError) {
          throw new RuntimeError(ErrorCodes.InvalidAgentOutput, 'Output do Agent Assist inválido.', error);
        }
        throw asRuntimeError(error, ErrorCodes.AgentExecutionError);
      });
      const output = validateFlowAssistProposals(result.finalOutput, input);
      await persist(() => logger!.agentOutput(agent.name, output));
      try {
        await this.options.repository.finishExecution(executionId, {
          FinalAgent: agent.name, Success: 'Y', OutputJSON: JSON.stringify(output), FinishedAt: new Date(), DurationMs: duration(),
        });
        await logger.runtimeEnd(duration());
      } catch (error) { throw asRuntimeError(error, ErrorCodes.PersistenceError); }
      return { statusCode: 200, response: { Success: true, ExecutionUUID: executionUUID, ...output } };
    } catch (error) {
      const runtimeError = asRuntimeError(error);
      // Never return partial proposals on failure. Core owns fail-open and Step.
      if (executionId !== undefined) {
        try {
          await this.options.repository.failExecution(executionId, {
            Success: 'N', ErrorCode: runtimeError.code, ErrorMessage: runtimeError.message, FinishedAt: new Date(), DurationMs: duration(),
          });
        } catch { /* Persistence may itself be unavailable; still return failure. */ }
        try {
          await logger?.runtimeError(runtimeError.code, runtimeError.message, duration());
          await logger?.append('RUNTIME_END', { Status: 'FAILED', DurationMs: duration() });
        } catch { /* A log failure must not prevent execution finalization. */ }
      }
      return {
        statusCode: runtimeError.code === ErrorCodes.AgentNotFound ? 422 : 500,
        response: { Success: false, ExecutionUUID: executionUUID, Proposals: [], Error: { Code: runtimeError.code, Message: 'Não foi possível concluir o Agent Assist.' } },
      };
    }
  }
}
