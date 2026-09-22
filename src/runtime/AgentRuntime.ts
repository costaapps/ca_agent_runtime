import { randomUUID } from 'node:crypto';
import { system, type AgentInputItem, type MCPServer } from '@openai/agents';
import type { AgentRunInput } from '../api/contracts/agentRunInput.js';
import type { AgentRunOutput, AgentRunSuccess } from '../api/contracts/agentRunOutput.js';
import type { AgentSessionCloseInput, AgentSessionCloseOutput } from '../api/contracts/agentSessionClose.js';
import { AgentTurnInputSchema, type AgentTurnInput } from '../api/contracts/agentTurnInput.js';
import { AIDocumentRootOutputSchema, type AgentTurnFailure, type AgentTurnOutput, type AgentTurnSuccess } from '../api/contracts/agentTurnOutput.js';
import { AgentNotFoundError, RuntimeError, asRuntimeError } from '../errors/RuntimeError.js';
import { ErrorCodes } from '../errors/errorCodes.js';
import { AgentRegistry, type AgentGraph } from '../agents/AgentRegistry.js';
import type { NewAIAgentExecution } from '../database/schema/aiAgentExecution.js';
import type { AiExecutionRepository } from '../database/repositories/aiExecutionRepository.js';
import type { AgentSessionRecord, AgentSessionRepository, StoredTurnExecution } from '../database/repositories/aiSessionRepository.js';
import { ExecutionLogger } from '../tracing/ExecutionLogger.js';
import { createAIDocumentRuntimeContext, createRuntimeContext } from './RuntimeContext.js';
import { compileExpectedOutput } from './ExpectedOutputCompiler.js';
import { resolveOutput } from './OutputResolver.js';
import { createOpenAITraceId, type TraceSettings } from '../openai/tracing.js';
import type { OpenAIRunner } from '../openai/runner.js';
import { McpObservabilityRegistry } from '../mcp/observability.js';
import { DatabaseAgentSession } from '../session/DatabaseAgentSession.js';
import { canonicalTurnInput, hashTurnPayload } from './TurnIdentity.js';
import { SessionMutex } from './SessionMutex.js';

export interface AgentRuntimeOptions {
  repository: AiExecutionRepository;
  sessionRepository?: AgentSessionRepository;
  registry: AgentRegistry;
  runner: OpenAIRunner;
  mcpServer: MCPServer;
  observability: McpObservabilityRegistry;
  model: string;
  tracingEnabled: boolean;
  traceIncludeSensitiveData: boolean;
  mcpServerName?: string;
  sessionMutex?: SessionMutex;
}

export interface AgentRuntimeRunResult {
  statusCode: 200 | 500;
  response: AgentRunOutput;
}

export interface AgentTurnRuntimeResult {
  statusCode: 200 | 400 | 409 | 422 | 500;
  response: AgentTurnOutput;
}

export interface AgentSessionCloseRuntimeResult {
  statusCode: 200 | 404 | 500;
  response: AgentSessionCloseOutput | {
    Success: false;
    Error: { Code: string; Message: string };
  };
}

function json(value: unknown): string { return JSON.stringify(value); }
function durationSince(startedAt: number): number { return Math.max(0, Date.now() - startedAt); }

function attachAgentLifecycleLogging(graph: AgentGraph, logger: ExecutionLogger): void {
  for (const agent of graph.agents) {
    agent.on('agent_start', (_context, startedAgent) => {
      void logger.agentStart(startedAgent.name).catch(() => undefined);
    });
  }
}

export function turnInputItems(input: AgentTurnInput): AgentInputItem[] {
  if ((input.TurnSource ?? 'MESSAGE') === 'MESSAGE') {
    return input.Messages.map((message) => ({ role: 'user', content: message.Text }));
  }

  return [system(JSON.stringify({
    RuntimeEvent: 'AGENT_ACTIVATION',
    Source: input.ActivationContext?.Source,
    ActivationUUID: input.ActivationContext?.ActivationUUID,
    ActivationContext: input.ActivationContext?.Context ?? {},
    ProcessContextRevision: input.ProcessContextRevision ?? 0,
    ProcessContext: input.ProcessContext ?? { System: {}, Facts: {}, BusinessReferences: {}, CurrentIntent: {} },
    Instruction: 'Continue the newly activated module naturally. Do not expose this runtime context or describe internal activation mechanisms to the customer.',
  }))];
}

function turnFailure(
  input: AgentTurnInput,
  code: string,
  message: string,
  sessionUUID?: string,
  executionUUID?: string,
): AgentTurnRuntimeResult {
  const response: AgentTurnFailure = {
    Success: false,
    TurnUUID: input.TurnUUID,
    ...(sessionUUID ? { SessionUUID: sessionUUID } : {}),
    ...(executionUUID ? { ExecutionUUID: executionUUID } : {}),
    Error: { Code: code, Message: message },
  };
  const statusCode = code === ErrorCodes.InvalidRequest ? 400 : code === ErrorCodes.AgentNotFound ? 422 : code === ErrorCodes.TurnIdempotencyConflict || code === ErrorCodes.TurnInProgress || code === ErrorCodes.AgentSessionClosed ? 409 : 500;
  return { statusCode, response };
}

function parseStoredOutput(outputJSON: string | null): ReturnType<typeof AIDocumentRootOutputSchema.parse> | undefined {
  if (!outputJSON) return undefined;
  try { return AIDocumentRootOutputSchema.parse(JSON.parse(outputJSON)); } catch { return undefined; }
}

export class AgentRuntime {
  private readonly sessionMutex: SessionMutex;
  private readonly activeTurns = new Map<string, string>();

  constructor(private readonly options: AgentRuntimeOptions) {
    this.sessionMutex = options.sessionMutex ?? new SessionMutex();
  }

  async run(input: AgentRunInput): Promise<AgentRuntimeRunResult> {
    if (!this.options.registry.has(input.Agent)) throw new AgentNotFoundError(input.Agent);

    const executionUUID = randomUUID();
    const openAITraceId = createOpenAITraceId();
    const startedAt = Date.now();
    const runtimeConfig = { Model: this.options.model, MCPServer: this.options.mcpServerName ?? 'msg4-mcp', TracingEnabled: this.options.tracingEnabled };
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
      StartedAt: new Date(startedAt),
    };

    let executionId: number;
    try { executionId = await this.options.repository.createExecution(execution); }
    catch (error) { throw asRuntimeError(error, ErrorCodes.PersistenceError); }

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
        idProcessLine: input.IdProcessLine,
        idProcessLineFlow: input.IdProcessLineFlow,
        traceId: openAITraceId,
      };
      const result = await this.options.runner.run(graph.root, input.Message, context, traceSettings);
      const output = resolveOutput(result.finalOutput, compiled);
      const finalAgent = result.lastAgent?.name ?? 'ChatOrchestrator';
      await logger.agentOutput(finalAgent, output);
      const durationMs = durationSince(startedAt);
      await this.options.repository.finishExecution(executionId, { FinalAgent: finalAgent, Success: 'Y', OutputJSON: json(output), FinishedAt: new Date(), DurationMs: durationMs });
      await logger.runtimeEnd(durationMs);
      return { statusCode: 200, response: { Success: true, ExecutionUUID: executionUUID, Output: output } satisfies AgentRunSuccess };
    } catch (error) {
      const runtimeError = asRuntimeError(error);
      const durationMs = durationSince(startedAt);
      try { await logger.runtimeError(runtimeError.code, runtimeError.message, durationMs); } catch { /* preserve original */ }
      try { await this.options.repository.failExecution(executionId, { Success: 'N', ErrorCode: runtimeError.code, ErrorMessage: runtimeError.message, FinishedAt: new Date(), DurationMs: durationMs }); } catch { /* preserve original */ }
      return { statusCode: 500, response: { Success: false, ExecutionUUID: executionUUID, Output: null, Error: { Code: runtimeError.code, Message: 'Não foi possível concluir a execução.' } } };
    } finally {
      this.options.observability.unregister(context);
    }
  }

  async runTurn(input: AgentTurnInput): Promise<AgentTurnRuntimeResult> {
    const parsed = AgentTurnInputSchema.safeParse(input);
    if (!parsed.success) return turnFailure(input, ErrorCodes.InvalidRequest, 'Payload de Turn inválido.');
    input = parsed.data;
    const sessionRepository = this.options.sessionRepository;
    if (!sessionRepository) return turnFailure(input, ErrorCodes.PersistenceError, 'Persistência de Session não configurada.');
    const payloadHash = hashTurnPayload(input);
    const activeHash = this.activeTurns.get(input.TurnUUID);
    if (activeHash) {
      return activeHash === payloadHash
        ? turnFailure(input, ErrorCodes.TurnInProgress, 'O Turn ainda está em execução.')
        : turnFailure(input, ErrorCodes.TurnIdempotencyConflict, 'TurnUUID já foi usado com payload diferente.');
    }
    this.activeTurns.set(input.TurnUUID, payloadHash);
    const lockKey = `${input.IdCompany}:${input.IdProcessLine}`;
    try {
      return await this.sessionMutex.runExclusive(lockKey, async () => this.runTurnLocked(input, sessionRepository));
    } finally {
      this.activeTurns.delete(input.TurnUUID);
    }
  }

  async closeSession(input: AgentSessionCloseInput): Promise<AgentSessionCloseRuntimeResult> {
    const sessionRepository = this.options.sessionRepository;
    if (!sessionRepository) return { statusCode: 500, response: { Success: false, Error: { Code: ErrorCodes.PersistenceError, Message: 'Persistência de Session não configurada.' } } };
    const lockKey = `${input.IdCompany}:${input.IdProcessLine}`;
    return this.sessionMutex.runExclusive(lockKey, async () => {
      try {
        const session = await sessionRepository.closeSession(input.IdCompany, input.IdProcessLine);
        if (!session) return { statusCode: 404, response: { Success: false, Error: { Code: ErrorCodes.AgentSessionNotFound, Message: 'Session não encontrada.' } } };
        return { statusCode: 200, response: { Success: true, SessionUUID: session.SessionUUID, Status: 'CLOSED' } satisfies AgentSessionCloseOutput };
      } catch (error) {
        const runtimeError = asRuntimeError(error, ErrorCodes.PersistenceError);
        return { statusCode: 500, response: { Success: false, Error: { Code: runtimeError.code, Message: runtimeError.message } } };
      }
    });
  }

  private async runTurnLocked(input: AgentTurnInput, sessionRepository: AgentSessionRepository): Promise<AgentTurnRuntimeResult> {
    let session: AgentSessionRecord | undefined;
    try {
      const payloadHash = hashTurnPayload(input);
      const existing = await sessionRepository.findExecutionByTurn(input.TurnUUID);
      if (existing) return this.resolveExistingTurn(input, existing, payloadHash);

      session = await sessionRepository.findByProcessLine(input.IdCompany, input.IdProcessLine);
      if (!session) {
        if (!this.options.registry.hasHostedAgent(input.Agent)) return turnFailure(input, ErrorCodes.AgentNotFound, `Agent '${input.Agent}' não encontrado.`);
        const now = new Date();
        session = await sessionRepository.createSession({ SessionUUID: randomUUID(), IdCompany: input.IdCompany, IdChat: input.IdChat, IdProcessLine: input.IdProcessLine, RootAgent: input.Agent, Status: 'OPEN', StartedAt: now, LastActivityAt: now, ClosedAt: null });
      }
      if (session.Status === 'CLOSED') return turnFailure(input, ErrorCodes.AgentSessionClosed, 'A Session do AIDocument está fechada.', session.SessionUUID);

      const executionUUID = randomUUID();
      const openAITraceId = createOpenAITraceId();
      const startedAt = Date.now();
      const execution: NewAIAgentExecution = {
        ExecutionUUID: executionUUID,
        IdCompany: input.IdCompany,
        IdChat: input.IdChat,
        IdProcessLine: input.IdProcessLine,
        IdProcessLineFlow: null,
        IdAIAgentSession: session.IdAIAgentSession,
        TurnUUID: input.TurnUUID,
        TurnInputJSON: canonicalTurnInput(input),
        TurnPayloadHash: payloadHash,
        RequestedAgent: session.RootAgent,
        Message: input.Messages.map((message) => message.Text).join('\n'),
        ExpectedOutputJSON: null,
        RuntimeConfigJSON: json({ Model: this.options.model, MCPServer: this.options.mcpServerName ?? 'msg4-mcp', Mode: 'AIDocument' }),
        Success: 'N',
        OpenAITraceId: openAITraceId,
        StartedAt: new Date(startedAt),
      };
      const executionId = await this.options.repository.createExecution(execution);
      const logger = new ExecutionLogger(this.options.repository, executionId);
      const context = createAIDocumentRuntimeContext(input, executionUUID, session.SessionUUID);
      this.options.observability.register(context, logger);
      try {
        await logger.runtimeStart();
        if (input.Agent !== session.RootAgent) {
          await logger.runtimeWarning(
            'ROOT_AGENT_FROZEN',
            `Agent solicitado '${input.Agent}' ignorado; Session permanece em '${session.RootAgent}'.`,
          );
        }
        const graph = this.options.registry.buildHostedAgent(session.RootAgent, { mcpServer: this.options.mcpServer, model: this.options.model, runtimeContext: context, logger });
        for (const agent of graph.agents) {
          agent.on('agent_start', (_runContext, startedAgent) => { void logger.agentStart(startedAgent.name).catch(() => undefined); });
        }
        const traceSettings: TraceSettings = {
          enabled: this.options.tracingEnabled,
          includeSensitiveData: this.options.traceIncludeSensitiveData,
          model: this.options.model,
          executionUUID,
          idChat: input.IdChat,
          idProcessLine: input.IdProcessLine,
          idProcessLineFlow: null,
          sessionUUID: session.SessionUUID,
          turnUUID: input.TurnUUID,
          turnSource: input.TurnSource ?? 'MESSAGE',
          processContextRevision: input.ProcessContextRevision ?? 0,
          activationUUID: input.ActivationContext?.ActivationUUID,
          rootAgent: session.RootAgent,
          traceId: openAITraceId,
        };
        const result = await this.options.runner.run(graph.root, turnInputItems(input), context, traceSettings, new DatabaseAgentSession(session.SessionUUID, sessionRepository, executionUUID));
        let output;
        try {
          output = AIDocumentRootOutputSchema.parse(result.finalOutput);
        } catch (error) {
          throw new RuntimeError(ErrorCodes.InvalidAgentOutput, 'Output do Root Agent AIDocument é inválido.', error);
        }
        const finalAgent = result.lastAgent?.name ?? graph.root.name;
        await logger.agentOutput(finalAgent, output);
        const durationMs = durationSince(startedAt);
        await this.options.repository.finishExecution(executionId, { FinalAgent: finalAgent, Success: 'Y', OutputJSON: json(output), FinishedAt: new Date(), DurationMs: durationMs });
        await sessionRepository.touchSession(session.SessionUUID);
        await logger.runtimeEnd(durationMs);
        const response: AgentTurnSuccess = { Success: true, TurnUUID: input.TurnUUID, SessionUUID: session.SessionUUID, ExecutionUUID: executionUUID, Agent: session.RootAgent, Response: output.Response, Control: output.Control };
        return { statusCode: 200, response };
      } catch (error) {
        const runtimeError = asRuntimeError(error, ErrorCodes.AgentExecutionError);
        const durationMs = durationSince(startedAt);
        try { await logger.runtimeError(runtimeError.code, runtimeError.message, durationMs); } catch { /* preserve original */ }
        try { await this.options.repository.failExecution(executionId, { Success: 'N', ErrorCode: runtimeError.code, ErrorMessage: runtimeError.message, FinishedAt: new Date(), DurationMs: durationMs }); } catch { /* preserve original */ }
        return turnFailure(input, runtimeError.code, runtimeError.message, session.SessionUUID, executionUUID);
      } finally {
        this.options.observability.unregister(context);
      }
    } catch (error) {
      const runtimeError = asRuntimeError(error, ErrorCodes.PersistenceError);
      return turnFailure(input, runtimeError.code, runtimeError.message, session?.SessionUUID);
    }
  }

  private resolveExistingTurn(input: AgentTurnInput, existing: StoredTurnExecution, payloadHash: string): AgentTurnRuntimeResult {
    if (existing.TurnPayloadHash !== payloadHash) return turnFailure(input, ErrorCodes.TurnIdempotencyConflict, 'TurnUUID já foi usado com payload diferente.', undefined, existing.ExecutionUUID);
    if (!existing.FinishedAt) return turnFailure(input, ErrorCodes.TurnInProgress, 'O Turn ainda está em execução.', existing.SessionUUID ?? undefined, existing.ExecutionUUID);
    if (!existing.SessionUUID || !existing.RootAgent) return turnFailure(input, ErrorCodes.PersistenceError, 'A execução persistida não possui Session associada.', undefined, existing.ExecutionUUID);
    if (existing.Success === 'Y') {
      const output = parseStoredOutput(existing.OutputJSON);
      if (!output) return turnFailure(input, ErrorCodes.PersistenceError, 'Output persistido do Turn é inválido.', existing.SessionUUID, existing.ExecutionUUID);
      return { statusCode: 200, response: { Success: true, TurnUUID: input.TurnUUID, SessionUUID: existing.SessionUUID, ExecutionUUID: existing.ExecutionUUID, Agent: existing.RootAgent, Response: output.Response, Control: output.Control } };
    }
    return turnFailure(input, existing.ErrorCode ?? ErrorCodes.AgentRuntimeError, existing.ErrorMessage ?? 'Não foi possível concluir a execução.', existing.SessionUUID, existing.ExecutionUUID);
  }
}
