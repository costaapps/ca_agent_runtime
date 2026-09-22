import { describe, expect, it } from 'vitest';
import { Agent } from '@openai/agents';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { McpObservabilityRegistry } from '../../src/mcp/observability.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { MemorySessionRepository } from '../helpers/memorySessionRepository.js';
import type { RuntimeContextData } from '../../src/runtime/RuntimeContext.js';

function makeTurn(overrides: Partial<{ TurnUUID: string; Agent: string; Text: string; IdMessage: number }> = {}) {
  return {
    TurnUUID: overrides.TurnUUID ?? '14ed24ea-0000-4000-8000-000000000001',
    Agent: overrides.Agent ?? 'sales-agent',
    IdCompany: 1003,
    IdChat: 123,
    IdProcessLine: 456,
    Messages: [{ IdMessage: overrides.IdMessage ?? 1001, Text: overrides.Text ?? 'Quero comprar uma impressora.' }],
  };
}

function makeRuntime(repository: MemoryRepository, sessionRepository: MemorySessionRepository, runner: any) {
  return new AgentRuntime({
    repository,
    sessionRepository,
    registry: new AgentRegistry(),
    runner,
    mcpServer: createFakeMcpServer(),
    observability: new McpObservabilityRegistry(),
    model: 'test-model',
    tracingEnabled: true,
    traceIncludeSensitiveData: false,
  });
}

describe('AIDocument Agent Runtime', () => {
  it('creates a Session, persists the turn, and reuses the persisted result idempotently', async () => {
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    let calls = 0;
    const runtime = makeRuntime(repository, sessionRepository, {
      async run(agent: Agent<RuntimeContextData, any>, input: unknown, _context: RuntimeContextData) {
        calls += 1;
        expect(agent.name).toBe('SalesAgent');
        expect(input).toEqual([{ role: 'user', content: 'Quero comprar uma impressora.' }]);
        return { finalOutput: { Response: 'Vou consultar as opções.', Control: { CompletionRequested: false, Reason: null } }, lastAgent: { name: agent.name } };
      },
    });

    const first = await runtime.runTurn(makeTurn());
    const second = await runtime.runTurn(makeTurn());

    expect(first.statusCode).toBe(200);
    expect(second).toEqual(first);
    expect(calls).toBe(1);
    expect(sessionRepository.sessions[0]).toMatchObject({ RootAgent: 'sales-agent', Status: 'OPEN' });
    expect(repository.executions[0]?.data).toMatchObject({ TurnUUID: makeTurn().TurnUUID, IdProcessLineFlow: null, IdAIAgentSession: 1 });
  });

  it('freezes the RootAgent and detects a TurnUUID payload conflict', async () => {
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    const runtime = makeRuntime(repository, sessionRepository, {
      async run(agent: Agent<RuntimeContextData, any>) {
        return { finalOutput: { Response: agent.name, Control: { CompletionRequested: false, Reason: null } }, lastAgent: { name: agent.name } };
      },
    });

    const first = await runtime.runTurn(makeTurn());
    const differentAgent = await runtime.runTurn(makeTurn({ Agent: 'support-agent', TurnUUID: '14ed24ea-0000-4000-8000-000000000002' }));
    const conflict = await runtime.runTurn(makeTurn({ Text: 'Payload diferente' }));

    expect(first.response).toMatchObject({ Agent: 'sales-agent', Response: 'SalesAgent' });
    expect(differentAgent.response).toMatchObject({ Agent: 'sales-agent', Response: 'SalesAgent' });
    expect(repository.logs.some((entry) => entry.data.EventType === 'RUNTIME_WARNING' && entry.data.ErrorMessage?.startsWith('ROOT_AGENT_FROZEN:'))).toBe(true);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.response).toMatchObject({ Success: false, Error: { Code: 'TURN_IDEMPOTENCY_CONFLICT' } });
  });

  it('freezes reception-agent as the Session RootAgent even when a later Turn requests SalesAgent', async () => {
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    const runtime = new AgentRuntime({
      repository,
      sessionRepository,
      registry: new AgentRegistry(undefined, undefined, { receptionAgentVectorStoreIds: ['vs_company'] }),
      runner: {
        async run(agent: Agent<RuntimeContextData, any>) {
          return { finalOutput: { Response: agent.name, Control: { CompletionRequested: false, Reason: null } }, lastAgent: { name: agent.name } };
        },
      },
      mcpServer: createFakeMcpServer(),
      observability: new McpObservabilityRegistry(),
      model: 'test-model',
      tracingEnabled: true,
      traceIncludeSensitiveData: false,
    });

    const first = await runtime.runTurn(makeTurn({ Agent: 'reception-agent', Text: 'Olá' }));
    const second = await runtime.runTurn(makeTurn({ Agent: 'sales-agent', TurnUUID: '14ed24ea-0000-4000-8000-000000000004', IdMessage: 1004, Text: 'Quero comprar' }));

    expect(first.response).toMatchObject({ Agent: 'reception-agent', Response: 'ReceptionAgent' });
    expect(second.response).toMatchObject({ Agent: 'reception-agent', Response: 'ReceptionAgent' });
    expect(repository.logs.some((entry) => entry.data.EventType === 'RUNTIME_WARNING' && entry.data.ErrorMessage?.startsWith('ROOT_AGENT_FROZEN:'))).toBe(true);
  });

  it('creates distinct Reception, Sales, and CompanyMenu Sessions across ProcessLines and freezes each Root', async () => {
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    const runtime = new AgentRuntime({
      repository,
      sessionRepository,
      registry: new AgentRegistry(undefined, undefined, { receptionAgentVectorStoreIds: ['vs_company'] }),
      runner: {
        async run(agent: Agent<RuntimeContextData, any>) {
          return { finalOutput: { Response: agent.name, Control: { CompletionRequested: false, Reason: null } }, lastAgent: { name: agent.name } };
        },
      },
      mcpServer: createFakeMcpServer(),
      observability: new McpObservabilityRegistry(),
      model: 'test-model',
      tracingEnabled: true,
      traceIncludeSensitiveData: false,
    });

    const reception = await runtime.runTurn({ ...makeTurn({ Agent: 'reception-agent', Text: 'Olá' }), IdProcessLine: 100 });
    await runtime.closeSession({ IdCompany: 1003, IdProcessLine: 100, Reason: 'PROCESS_LINE_CLOSED' });
    const sales = await runtime.runTurn({
      TurnUUID: '14ed24ea-0000-4000-8000-000000000020', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 101,
      TurnSource: 'ACTIVATION', Messages: [],
      ActivationContext: { ActivationUUID: 'activation-handoff-101', Source: 'HANDOFF', Context: { Summary: 'Handoff para Vendas' } },
    });
    const frozen = await runtime.runTurn({ ...makeTurn({ Agent: 'support-agent', TurnUUID: '14ed24ea-0000-4000-8000-000000000021', IdMessage: 21, Text: 'Ainda sobre a compra' }), IdProcessLine: 101 });
    await runtime.closeSession({ IdCompany: 1003, IdProcessLine: 101, Reason: 'PROCESS_LINE_CLOSED' });
    const receptionAfterCompletion = await runtime.runTurn({
      TurnUUID: '14ed24ea-0000-4000-8000-000000000022', Agent: 'reception-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 102,
      TurnSource: 'ACTIVATION', Messages: [],
      ActivationContext: { ActivationUUID: 'activation-completed-102', Source: 'MODULE_COMPLETED', Context: { Summary: 'Etapa de Vendas concluída' } },
    });

    expect(reception.response).toMatchObject({ Agent: 'reception-agent', Response: 'ReceptionAgent' });
    expect(sales.response).toMatchObject({ Agent: 'sales-agent', Response: 'SalesAgent' });
    expect(frozen.response).toMatchObject({ Agent: 'sales-agent', Response: 'SalesAgent' });
    expect(receptionAfterCompletion.response).toMatchObject({ Agent: 'reception-agent', Response: 'ReceptionAgent' });
    expect(sessionRepository.sessions).toHaveLength(3);
    expect(sessionRepository.sessions.map((session) => [session.IdProcessLine, session.RootAgent])).toEqual([
      [100, 'reception-agent'],
      [101, 'sales-agent'],
      [102, 'reception-agent'],
    ]);
    const sessionUUIDs = sessionRepository.sessions.map((session) => session.SessionUUID);
    expect(new Set(sessionUUIDs).size).toBe(3);
    expect(repository.logs.some((entry) => entry.data.EventType === 'RUNTIME_WARNING' && entry.data.ErrorMessage?.startsWith('ROOT_AGENT_FROZEN:'))).toBe(true);
  });

  it('rejects a reused TurnUUID before creating a Session for another ProcessLine', async () => {
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    const runtime = makeRuntime(repository, sessionRepository, {
      async run(agent: Agent<RuntimeContextData, any>) {
        return { finalOutput: { Response: agent.name, Control: { CompletionRequested: false, Reason: null } }, lastAgent: { name: agent.name } };
      },
    });

    const first = await runtime.runTurn(makeTurn());
    const conflictingProcessLine = await runtime.runTurn({ ...makeTurn({ Text: 'Payload diferente' }), IdProcessLine: 999 });

    expect(first.statusCode).toBe(200);
    expect(conflictingProcessLine).toMatchObject({ statusCode: 409, response: { Success: false, Error: { Code: 'TURN_IDEMPOTENCY_CONFLICT' } } });
    expect(sessionRepository.sessions).toHaveLength(1);
    expect(sessionRepository.sessions[0]).toMatchObject({ IdProcessLine: 456 });
  });

  it('serializes runs of the same Session and rejects turns after close', async () => {
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    let active = 0;
    let maximum = 0;
    const runtime = makeRuntime(repository, sessionRepository, {
      async run(agent: Agent<RuntimeContextData, any>) {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return { finalOutput: { Response: agent.name, Control: { CompletionRequested: false, Reason: null } }, lastAgent: { name: agent.name } };
      },
    });

    const [first, second] = await Promise.all([
      runtime.runTurn(makeTurn()),
      runtime.runTurn(makeTurn({ TurnUUID: '14ed24ea-0000-4000-8000-000000000002', IdMessage: 1002, Text: 'Também quero preta.' })),
    ]);
    const closed = await runtime.closeSession({ IdCompany: 1003, IdProcessLine: 456, Reason: 'PROCESS_LINE_CLOSED' });
    const closedAgain = await runtime.closeSession({ IdCompany: 1003, IdProcessLine: 456, Reason: 'PROCESS_LINE_CLOSED' });
    const retryCompleted = await runtime.runTurn(makeTurn());
    const afterClose = await runtime.runTurn(makeTurn({ TurnUUID: '14ed24ea-0000-4000-8000-000000000003' }));

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(maximum).toBe(1);
    expect(closed).toMatchObject({ statusCode: 200, response: { Success: true, Status: 'CLOSED' } });
    expect(closedAgain).toEqual(closed);
    expect(retryCompleted).toMatchObject({ statusCode: 200, response: { Success: true } });
    expect(afterClose).toMatchObject({ statusCode: 409, response: { Success: false, Error: { Code: 'AGENT_SESSION_CLOSED' } } });
  });

  it('returns TURN_IN_PROGRESS for a duplicate request while the first run is active', async () => {
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const runtime = makeRuntime(repository, sessionRepository, {
      async run(agent: Agent<RuntimeContextData, any>) {
        started();
        await new Promise<void>((resolve) => { release = resolve; });
        return { finalOutput: { Response: agent.name, Control: { CompletionRequested: false, Reason: null } }, lastAgent: { name: agent.name } };
      },
    });
    const firstPromise = runtime.runTurn(makeTurn());
    await startedPromise;
    const duplicate = await runtime.runTurn(makeTurn());
    release();
    const first = await firstPromise;
    expect(duplicate).toMatchObject({ statusCode: 409, response: { Success: false, Error: { Code: 'TURN_IN_PROGRESS' } } });
    expect(first.statusCode).toBe(200);
  });

  it('persists final errors and does not rerun a failed TurnUUID', async () => {
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    let calls = 0;
    const runtime = makeRuntime(repository, sessionRepository, {
      async run() {
        calls += 1;
        throw new Error('modelo indisponível');
      },
    });
    const first = await runtime.runTurn(makeTurn());
    const second = await runtime.runTurn(makeTurn());
    expect(first).toMatchObject({ statusCode: 500, response: { Success: false, Error: { Code: 'AGENT_EXECUTION_ERROR' } } });
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });

  it('runs ACTIVATION without creating a fake user message and exposes its contexts', async () => {
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    let receivedInput: unknown;
    let receivedContext: RuntimeContextData | undefined;
    const runtime = makeRuntime(repository, sessionRepository, {
      async run(agent: Agent<RuntimeContextData, any>, input: unknown, context: RuntimeContextData) {
        receivedInput = input;
        receivedContext = context;
        return { finalOutput: { Response: 'Atendimento retomado.', Control: { CompletionRequested: false, Reason: null } }, lastAgent: { name: agent.name } };
      },
    });
    const result = await runtime.runTurn({
      TurnUUID: '14ed24ea-0000-4000-8000-000000000010', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 460,
      TurnSource: 'ACTIVATION', Messages: [], ProcessContextRevision: 7,
      ProcessContext: { System: {}, Facts: { ProductInterest: 'RAM' }, BusinessReferences: {}, CurrentIntent: {} },
      ActivationContext: { ActivationUUID: 'activation-10', Source: 'HANDOFF', Context: { Summary: 'Cliente foi direcionado' } },
    });
    expect(result.statusCode).toBe(200);
    expect(JSON.stringify(receivedInput)).toContain('AGENT_ACTIVATION');
    expect(JSON.stringify(receivedInput)).not.toContain('role":"user"');
    expect(receivedContext?.Execution).toMatchObject({ TurnSource: 'ACTIVATION', ProcessContextRevision: 7, ActivationUUID: 'activation-10' });
    expect(receivedContext?.ProcessContext).toMatchObject({ Facts: { ProductInterest: 'RAM' } });
  });

  it.each([
    ['MODULE_COMPLETED', 'reception-agent', 462, '000000000013'],
    ['OUTBOUND', 'sales-agent', 463, '000000000014'],
    ['QUEUED', 'sales-agent', 464, '000000000015'],
    ['SEQUENTIAL', 'sales-agent', 465, '000000000016'],
  ] as const)('accepts %s activation without a customer Message', async (source, agent, processLine, turnSuffix) => {
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    let receivedInput: unknown;
    const runtime = new AgentRuntime({
      repository,
      sessionRepository,
      registry: new AgentRegistry(undefined, undefined, { receptionAgentVectorStoreIds: ['vs_company'] }),
      runner: {
        async run(_agent: Agent<RuntimeContextData, any>, input: unknown) {
          receivedInput = input;
          return { finalOutput: { Response: 'Ativação processada.', Control: { CompletionRequested: false, Reason: null } }, lastAgent: { name: 'ReceptionAgent' } };
        },
      },
      mcpServer: createFakeMcpServer(),
      observability: new McpObservabilityRegistry(),
      model: 'test-model',
      tracingEnabled: true,
      traceIncludeSensitiveData: false,
    });

    const result = await runtime.runTurn({
      TurnUUID: `14ed24ea-0000-4000-8000-${turnSuffix}`,
      Agent: agent,
      IdCompany: 1003,
      IdChat: 123,
      IdProcessLine: processLine,
      TurnSource: 'ACTIVATION',
      Messages: [],
      ProcessContextRevision: 3,
      ProcessContext: { System: {}, Facts: {}, BusinessReferences: {}, CurrentIntent: {} },
      ActivationContext: { ActivationUUID: `activation-${source.toLowerCase()}`, Source: source, Context: { Summary: source } },
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.stringify(receivedInput)).toContain('AGENT_ACTIVATION');
    expect(JSON.stringify(receivedInput)).not.toContain('role":"user"');
    expect(sessionRepository.sessions[0]).toMatchObject({ IdProcessLine: processLine, RootAgent: agent });
  });

  it('rejects an ACTIVATION that carries a real user Message before creating a Session', async () => {
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    const runtime = makeRuntime(repository, sessionRepository, {
      async run() {
        throw new Error('não deveria executar');
      },
    });

    const result = await runtime.runTurn({
      TurnUUID: '14ed24ea-0000-4000-8000-000000000011', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 461,
      TurnSource: 'ACTIVATION', Messages: [{ IdMessage: 1005, Text: 'fala real' }],
      ActivationContext: { ActivationUUID: 'activation-11', Source: 'HANDOFF', Context: {} },
    });

    expect(result).toMatchObject({ statusCode: 400, response: { Success: false, Error: { Code: 'INVALID_REQUEST' } } });
    expect(sessionRepository.sessions).toHaveLength(0);
    expect(repository.executions).toHaveLength(0);
  });

  it('passes the current Core ProcessContext view on every turn instead of inferring it from Session memory', async () => {
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    const contexts: RuntimeContextData[] = [];
    const runtime = makeRuntime(repository, sessionRepository, {
      async run(_agent: Agent<RuntimeContextData, any>, _input: unknown, context: RuntimeContextData) {
        contexts.push(context);
        return { finalOutput: { Response: 'Ok', Control: { CompletionRequested: false, Reason: null } }, lastAgent: { name: 'SalesAgent' } };
      },
    });

    await runtime.runTurn({
      ...makeTurn(), ProcessContextRevision: 5,
      ProcessContext: { System: {}, Facts: { ProductInterest: 'RAM' }, BusinessReferences: {}, CurrentIntent: {} },
    });
    await runtime.runTurn({
      ...makeTurn({ TurnUUID: '14ed24ea-0000-4000-8000-000000000012', IdMessage: 1006, Text: 'Agora é SSD' }), ProcessContextRevision: 6,
      ProcessContext: { System: {}, Facts: { ProductInterest: 'SSD' }, BusinessReferences: { IdItem: 20 }, CurrentIntent: { Type: 'PRODUCT_PURCHASE' } },
    });

    expect(contexts[0]?.Execution.ProcessContextRevision).toBe(5);
    expect(contexts[0]?.ProcessContext).toMatchObject({ Facts: { ProductInterest: 'RAM' }, BusinessReferences: {} });
    expect(contexts[1]?.Execution.ProcessContextRevision).toBe(6);
    expect(contexts[1]?.ProcessContext).toMatchObject({ Facts: { ProductInterest: 'SSD' }, BusinessReferences: { IdItem: 20 }, CurrentIntent: { Type: 'PRODUCT_PURCHASE' } });
    expect(sessionRepository.sessions).toHaveLength(1);
  });

  it('returns CompletionRequested to the Core without closing the Session', async () => {
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    const runtime = makeRuntime(repository, sessionRepository, {
      async run(agent: Agent<RuntimeContextData, any>) {
        return {
          finalOutput: { Response: 'Atendimento concluído.', Control: { CompletionRequested: true, Reason: 'Cliente encerrou a conversa.' } },
          lastAgent: { name: agent.name },
        };
      },
    });

    const result = await runtime.runTurn(makeTurn());

    expect(result.response).toMatchObject({ Success: true, Response: 'Atendimento concluído.', Control: { CompletionRequested: true, Reason: 'Cliente encerrou a conversa.' } });
    expect(sessionRepository.sessions[0]).toMatchObject({ Status: 'OPEN', ClosedAt: null });
  });
});
