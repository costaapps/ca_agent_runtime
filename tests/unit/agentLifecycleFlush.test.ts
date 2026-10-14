import { describe, expect, it, vi } from 'vitest';
import { Agent } from '@openai/agents';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { TenantRuntimeGateway } from '../../src/api/TenantRuntimeGateway.js';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { McpObservabilityRegistry } from '../../src/mcp/observability.js';
import type { RuntimeContextData } from '../../src/runtime/RuntimeContext.js';
import type { AiExecutionRepository, ExecutionLogRecord } from '../../src/database/repositories/aiExecutionRepository.js';
import type { RuntimeDatabase } from '../../src/database/connection.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { MemorySessionRepository } from '../helpers/memorySessionRepository.js';
import { TenantConnectionManager, type TenantDatabaseHandle } from '../../src/tenancy/ConnectionManager.js';
import { createTenantDescriptor, type TenantDescriptor } from '../../src/tenancy/TenantDescriptor.js';
import type { CentralRegistry } from '../../src/tenancy/CentralRegistry.js';

const companyUUID = 'd2719f62-8a67-4fd5-a6ae-411a6a3ef177';
const runInput = {
  CompanyUUID: companyUUID,
  Agent: 'chat-orchestrator-poc',
  IdCompany: 44,
  IdChat: 100,
  IdProcessLine: 200,
  IdProcessLineFlow: 300,
  Message: 'hello',
  ExpectedOutput: { Name: 'Reply', Description: 'A short reply.' },
};

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function descriptor(password: string): TenantDescriptor {
  return createTenantDescriptor({
    CompanyUUID: companyUUID,
    IdDatabase: 10,
    IdCompany: 44,
    database: { host: 'db.internal', port: 3306, database: 'tenant_a', user: 'runtime', password },
  });
}

function fakeHandle() {
  const state = { closed: 0 };
  return {
    state,
    value: {
      db: {} as RuntimeDatabase,
      pool: {
        async query() { return [[{ ok: 1 }], []]; },
        async end() { state.closed += 1; },
      },
    } satisfies TenantDatabaseHandle,
  };
}

function createRunRuntime(repository: AiExecutionRepository, run: (agent: Agent<RuntimeContextData, any>) => Promise<unknown>) {
  const registry = new AgentRegistry({
    'chat-orchestrator-poc': (build) => {
      const agent = new Agent<RuntimeContextData, any>({ name: 'ChatOrchestrator', instructions: 'test', outputType: build.outputType as any });
      return { root: agent, agents: [agent] };
    },
  });
  return new AgentRuntime({
    repository,
    registry,
    runner: { async run(agent) { return run(agent as Agent<RuntimeContextData, any>) as any; } },
    mcpServer: createFakeMcpServer(),
    observability: new McpObservabilityRegistry(),
    model: 'test-model',
    tracingEnabled: false,
    traceIncludeSensitiveData: false,
  });
}

function createGateway(runtime: AgentRuntime, resolveDescriptor: () => Promise<TenantDescriptor>, release: () => Promise<void>) {
  const gateway = new TenantRuntimeGateway({
    allowlist: [companyUUID],
    registry: { resolve: resolveDescriptor } as unknown as CentralRegistry,
    connections: {
      async acquire(resolvedDescriptor: TenantDescriptor) {
        return { descriptor: resolvedDescriptor, db: {} as RuntimeDatabase, release };
      },
    } as unknown as TenantConnectionManager,
    buildRuntime: () => runtime,
  });
  return gateway;
}

describe('AgentRuntime lifecycle log flush', () => {
  it('holds the old rotated pool lease and shutdown drain until AGENT_START persistence completes', async () => {
    const repository = new MemoryRepository();
    const logStarted = deferred();
    const finishAgentStartLog = deferred();
    const inferenceFinished = deferred();
    const appendLog = repository.appendLog.bind(repository);
    repository.appendLog = async (id: number, record: ExecutionLogRecord) => {
      if (record.EventType === 'AGENT_START') {
        logStarted.resolve();
        await finishAgentStartLog.promise;
      }
      await appendLog(id, record);
    };

    let runnerCalls = 0;
    const runtime = createRunRuntime(repository, async (agent) => {
      runnerCalls += 1;
      if (runnerCalls === 1) {
        // AgentHooks delegates to Node's synchronous EventEmitter. Its returned
        // listener value is not awaited by emit or by this fake Runner.
        agent.emit('agent_start', {} as any, agent);
        inferenceFinished.resolve();
      }
      return { finalOutput: { Reply: 'hello' }, lastAgent: { name: agent.name } };
    });

    const handles: ReturnType<typeof fakeHandle>[] = [];
    const connections = new TenantConnectionManager({
      maxPools: 2,
      sweepIntervalMs: 0,
      createHandle: () => {
        const handle = fakeHandle();
        handles.push(handle);
        return handle.value;
      },
    });
    let resolutions = 0;
    const gateway = new TenantRuntimeGateway({
      allowlist: [companyUUID],
      registry: {
        resolve: async () => ++resolutions === 1 ? descriptor('old-generation') : descriptor('new-generation'),
      } as unknown as CentralRegistry,
      connections,
      buildRuntime: () => runtime,
    });

    const oldExecution = gateway.run(runInput);
    await Promise.all([logStarted.promise, inferenceFinished.promise]);
    expect(gateway.getActiveRequestCount()).toBe(1);

    // A new descriptor rotates the pool while the first execution is still
    // flushing its lifecycle log. The old generation must remain leased/open.
    await gateway.run(runInput);
    expect(handles).toHaveLength(2);
    expect(connections.getStats()).toMatchObject({ activeLeases: 1, drainingPoolCount: 1 });
    expect(handles[0]?.state.closed).toBe(0);
    expect(repository.executions[0]?.final).toBeUndefined();

    gateway.stopAccepting();
    expect(await gateway.waitForDrain(10)).toBe(false);
    expect(gateway.getActiveRequestCount()).toBe(1);

    finishAgentStartLog.resolve();
    await expect(oldExecution).resolves.toMatchObject({ statusCode: 200 });
    expect(repository.logs.some((entry) => entry.data.EventType === 'AGENT_START')).toBe(true);
    expect(handles[0]?.state.closed).toBe(1);
    expect(await gateway.waitForDrain(100)).toBe(true);
    expect(gateway.getActiveRequestCount()).toBe(0);

    await connections.close();
    expect(handles[1]?.state.closed).toBe(1);
  });

  it('flushes a failing Turn lifecycle write before releasing the lease and reports only sanitized diagnostics', async () => {
    const repository = new MemoryRepository();
    const logStarted = deferred();
    const failAgentStartLog = deferred();
    const appendLog = repository.appendLog.bind(repository);
    repository.appendLog = async (id: number, record: ExecutionLogRecord) => {
      if (record.EventType === 'AGENT_START') {
        logStarted.resolve();
        await failAgentStartLog.promise;
        throw new Error('host=db.internal user=runtime password=do-not-log SQL=INSERT secret-param');
      }
      await appendLog(id, record);
    };
    const agent = new Agent<RuntimeContextData, any>({ name: 'ReceptionAgent', instructions: 'test' });
    const registry = new AgentRegistry(undefined, {
      'reception-agent': () => ({ root: agent, agents: [agent] }),
    });
    const runnerStarted = deferred();
    const runtime = new AgentRuntime({
      repository,
      sessionRepository: new MemorySessionRepository(repository),
      registry,
      runner: {
        async run() {
          agent.emit('agent_start', {} as any, agent);
          runnerStarted.resolve();
          throw new Error('model request failed');
        },
      },
      mcpServer: createFakeMcpServer(),
      observability: new McpObservabilityRegistry(),
      model: 'test-model',
      tracingEnabled: false,
      traceIncludeSensitiveData: false,
    });

    let released = false;
    const gateway = createGateway(runtime, async () => descriptor('stable'), async () => { released = true; });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const turnExecution = gateway.runTurn({
      CompanyUUID: companyUUID,
      TurnUUID: '14ed24ea-0000-4000-8000-000000000001',
      Agent: 'reception-agent',
      IdCompany: 44,
      IdChat: 100,
      IdProcessLine: 200,
      Messages: [{ IdMessage: 1, Text: 'hello' }],
    });

    try {
      await Promise.all([logStarted.promise, runnerStarted.promise]);
      expect(gateway.getActiveRequestCount()).toBe(1);
      expect(released).toBe(false);
      expect(repository.executions[0]?.final).toBeUndefined();
      gateway.stopAccepting();
      expect(await gateway.waitForDrain(10)).toBe(false);

      failAgentStartLog.resolve();
      await expect(turnExecution).resolves.toMatchObject({ statusCode: 500 });
      expect(released).toBe(true);
      expect(await gateway.waitForDrain(100)).toBe(true);
      expect(errorLog).toHaveBeenCalledWith(JSON.stringify({
        Event: 'EXECUTION_LIFECYCLE_LOG_FAILED',
        LogEvent: 'AGENT_START',
      }));
      expect(errorLog.mock.calls.flat().join(' ')).not.toMatch(/db\.internal|runtime|do-not-log|INSERT|secret-param/);
    } finally {
      errorLog.mockRestore();
      failAgentStartLog.resolve();
    }
  });
});
