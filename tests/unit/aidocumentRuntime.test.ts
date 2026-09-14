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
});
