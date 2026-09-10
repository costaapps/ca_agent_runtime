import { randomUUID } from 'node:crypto';
import type { MCPServer } from '@openai/agents';
import type { AgentRunInput } from '../api/contracts/agentRunInput.js';
import type { AgentRunOutput, AgentRunSuccess } from '../api/contracts/agentRunOutput.js';
import { AgentNotFoundError, asRuntimeError } from '../errors/RuntimeError.js';
import { ErrorCodes } from '../errors/errorCodes.js';
import { AgentRegistry, type AgentGraph } from '../agents/AgentRegistry.js';
import type { NewAIAgentExecution } from '../database/schema/aiAgentExecution.js';
import type { AiExecutionRepository } from '../database/repositories/aiExecutionRepository.js';
import { ExecutionLogger } from '../tracing/ExecutionLogger.js';
import { createRuntimeContext } from './RuntimeContext.js';
import { compileExpectedOutput } from './ExpectedOutputCompiler.js';
import { resolveOutput } from './OutputResolver.js';
import { createOpenAITraceId, type TraceSettings } from '../openai/tracing.js';
import type { OpenAIRunner } from '../openai/runner.js';
import { McpObservabilityRegistry } from '../mcp/observability.js';

export interface AgentRuntimeOptions {
  repository: AiExecutionRepository;
  registry: AgentRegistry;
  runner: OpenAIRunner;
  mcpServer: MCPServer;
  observability: McpObservabilityRegistry;
  model: string;
  tracingEnabled: boolean;
  traceIncludeSensitiveData: boolean;
  mcpServerName?: string;
}

export interface AgentRuntimeRunResult {
  statusCode: 200 | 500;
  response: AgentRunOutput;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function durationSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function attachAgentLifecycleLogging(graph: AgentGraph, logger: ExecutionLogger): void {
  for (const agent of graph.agents) {
    agent.on('agent_start', (_context, startedAgent) => {
      void logger.agentStart(startedAgent.name).catch(() => undefined);
    });
  }
}

export class AgentRuntime {
  constructor(private readonly options: AgentRuntimeOptions) {}

  async run(input: AgentRunInput): Promise<AgentRuntimeRunResult> {
    if (!this.options.registry.has(input.Agent)) throw new AgentNotFoundError(input.Agent);

    const executionUUID = randomUUID();
    const openAITraceId = createOpenAITraceId();
    const startedAt = Date.now();
    const startedDate = new Date(startedAt);
    const runtimeConfig = {
      Model: this.options.model,
      MCPServer: this.options.mcpServerName ?? 'msg4-mcp',
      TracingEnabled: this.options.tracingEnabled,
    };

    const execution: NewAIAgentExecution = {
      ExecutionUUID: executionUUID,
      IdCompany: input.IdCompany,
      IdChat: input.IdChat,
      IdProcessLine: input.IdProcessLine,
      IdProcessLineFlow: input.IdProcessLineFlow,
      RequestedAgent: input.Agent,
      Message: input.Message,
      ExpectedOutputJSON: json(input.ExpectedOutput),
      RuntimeConfigJSON: json(runtimeConfig),
      Success: 'N',
      OpenAITraceId: openAITraceId,
      StartedAt: startedDate,
    };

    let executionId: number;
    try {
      executionId = await this.options.repository.createExecution(execution);
    } catch (error) {
      throw asRuntimeError(error, ErrorCodes.PersistenceError);
    }

    const logger = new ExecutionLogger(this.options.repository, executionId);
    const context = createRuntimeContext(input, executionUUID);
    this.options.observability.register(context, logger);

    try {
      await logger.runtimeStart();
      const compiled = compileExpectedOutput(input.ExpectedOutput);
      const graph = this.options.registry.build(input.Agent, {
        outputType: compiled.outputType,
        expectedOutput: compiled,
        mcpServer: this.options.mcpServer,
        model: this.options.model,
        runtimeContext: context,
        logger,
      });
      attachAgentLifecycleLogging(graph, logger);

      const traceSettings: TraceSettings = {
        enabled: this.options.tracingEnabled,
        includeSensitiveData: this.options.traceIncludeSensitiveData,
        model: this.options.model,
        executionUUID,
        idChat: input.IdChat,
        idProcessLineFlow: input.IdProcessLineFlow,
        traceId: openAITraceId,
      };
      const result = await this.options.runner.run(graph.root, input.Message, context, traceSettings);
      const output = resolveOutput(result.finalOutput, compiled);
      const finalAgent = result.lastAgent?.name ?? 'ChatOrchestrator';
      await logger.agentOutput(finalAgent, output);

      const durationMs = durationSince(startedAt);
      await this.options.repository.finishExecution(executionId, {
        FinalAgent: finalAgent,
        Success: 'Y',
        OutputJSON: json(output),
        FinishedAt: new Date(),
        DurationMs: durationMs,
      });
      await logger.runtimeEnd(durationMs);
      return {
        statusCode: 200,
        response: { Success: true, ExecutionUUID: executionUUID, Output: output } satisfies AgentRunSuccess,
      };
    } catch (error) {
      const runtimeError = asRuntimeError(error);
      const durationMs = durationSince(startedAt);
      try {
        await logger.runtimeError(runtimeError.code, runtimeError.message, durationMs);
      } catch {
        // A logging failure must not hide the original execution failure.
      }
      try {
        await this.options.repository.failExecution(executionId, {
          Success: 'N',
          ErrorCode: runtimeError.code,
          ErrorMessage: runtimeError.message,
          FinishedAt: new Date(),
          DurationMs: durationMs,
        });
      } catch {
        // The response still carries the execution UUID for operational recovery.
      }
      return {
        statusCode: 500,
        response: {
          Success: false,
          ExecutionUUID: executionUUID,
          Output: null,
          Error: {
            Code: runtimeError.code,
            Message: 'Não foi possível concluir a execução.',
          },
        },
      };
    } finally {
      this.options.observability.unregister(context);
    }
  }
}
