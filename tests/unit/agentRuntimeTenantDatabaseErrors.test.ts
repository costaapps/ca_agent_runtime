import type { Request, Response } from 'express';
import { Agent } from '@openai/agents';
import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { createAgentController } from '../../src/api/controllers/agentController.js';
import { createAgentSessionController } from '../../src/api/controllers/agentSessionController.js';
import { createAgentTurnController } from '../../src/api/controllers/agentTurnController.js';
import { createFlowAssistController } from '../../src/api/controllers/flowAssistController.js';
import { TenantRuntimeGateway } from '../../src/api/TenantRuntimeGateway.js';
import type { RuntimeDatabase } from '../../src/database/connection.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { MemorySessionRepository } from '../helpers/memorySessionRepository.js';
import type { RuntimeContextData } from '../../src/runtime/RuntimeContext.js';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { McpObservabilityRegistry } from '../../src/mcp/observability.js';
import { createTenantDescriptor, type TenantDescriptor } from '../../src/tenancy/TenantDescriptor.js';
import { TenantConnectionManager } from '../../src/tenancy/ConnectionManager.js';
import type { CentralRegistry } from '../../src/tenancy/CentralRegistry.js';
import { flowAssistCheckInput, flowAssistInput } from '../helpers/flowAssist.js';

const COMPANY_A = 'd2719f62-8a67-4fd5-a6ae-411a6a3ef177';
const COMPANY_B = 'a9f18f14-670a-4f98-94d1-c609d575b423';
const SAFE_DATABASE_MESSAGE = 'Base da empresa temporariamente indisponível.';

const runInput = {
  CompanyUUID: COMPANY_A,
  Agent: 'chat-orchestrator-poc',
  IdCompany: 45,
  IdChat: 100,
  IdProcessLine: 200,
  IdProcessLineFlow: 300,
  Message: 'hello',
  ExpectedOutput: { Name: 'Intent', Description: 'Classifique a mensagem.' },
};

const turnInput = {
  CompanyUUID: COMPANY_A,
  TurnUUID: '14ed24ea-0000-4000-8000-000000000611',
  Agent: 'sales-agent',
  IdCompany: 45,
  IdChat: 100,
  IdProcessLine: 200,
  Messages: [{ IdMessage: 1, Text: 'hello' }],
};

interface HttpResult { statusCode: number; body: unknown; }

async function invokeController(
  controller: (request: Request, response: Response) => Promise<void>,
  body: unknown,
): Promise<HttpResult> {
  const result: HttpResult = { statusCode: 0, body: undefined };
  const response = {
    status(statusCode: number) { result.statusCode = statusCode; return this; },
    json(value: unknown) { result.body = value; return this; },
  };
  await controller({ body } as Request, response as unknown as Response);
  return result;
}

function databaseUnavailable(): Error {
  const driverError = Object.assign(
    new Error('connect ECONNRESET host=tenant.internal user=runtime password=secret query=private'),
    { code: 'ECONNRESET' },
  );
  return new DrizzleQueryError('SELECT * FROM AIAgentExecution', ['secret-parameter'], driverError);
}

function descriptor(companyUUID: string, idDatabase: number, idCompany: number): TenantDescriptor {
  return createTenantDescriptor({
    CompanyUUID: companyUUID,
    IdDatabase: idDatabase,
    IdCompany: idCompany,
    database: {
      host: '127.0.0.1',
      port: 3306,
      database: `tenant_${idDatabase}`,
      user: 'runtime',
      password: 'private',
    },
  });
}

describe('tenant database errors at AgentRuntime HTTP boundaries', () => {
  it('returns sanitized 503 after reusing a warmed pool across Runs, Turns, Close and Flow Assist modes', async () => {
    const tenantA = descriptor(COMPANY_A, 11, 45);
    const tenantB = descriptor(COMPANY_B, 12, 55);
    const descriptors = new Map([[COMPANY_A, tenantA], [COMPANY_B, tenantB]]);
    const repositories = new Map<number, MemoryRepository>();
    const sessionRepositories = new Map<number, MemorySessionRepository>();
    const finishCounts = new Map<number, number>();
    let handleCreations = 0;
    let healthQueries = 0;

    const connections = new TenantConnectionManager({
      maxPools: 2,
      sweepIntervalMs: 0,
      createHandle: () => {
        handleCreations += 1;
        return {
          db: {} as RuntimeDatabase,
          pool: {
            async query() { healthQueries += 1; return [[{ ok: 1 }], []]; },
            async end() {},
          },
        };
      },
    });

    const agentRegistry = new AgentRegistry({
      'chat-orchestrator-poc': (build) => {
        const agent = new Agent<RuntimeContextData, any>({ name: 'ChatOrchestrator', instructions: 'test', outputType: build.outputType as any });
        return { root: agent, agents: [agent] };
      },
    });

    const gateway = new TenantRuntimeGateway({
      allowlist: [COMPANY_A, COMPANY_B],
      registry: { resolve: async (uuid: string) => descriptors.get(uuid)! } as unknown as CentralRegistry,
      connections,
      buildRuntime: (resolved) => {
        const idDatabase = resolved.IdDatabase;
        let repository = repositories.get(idDatabase);
        if (!repository) {
          repository = new MemoryRepository();
          repositories.set(idDatabase, repository);
          if (idDatabase === tenantA.IdDatabase) {
            const originalCreate = repository.createExecution.bind(repository);
            repository.createExecution = async (execution) => {
              if (execution.RequestedAgent === 'flow-assist-agent') throw databaseUnavailable();
              return originalCreate(execution);
            };
            const originalFinish = repository.finishExecution.bind(repository);
            repository.finishExecution = async (executionId, patch) => {
              const count = (finishCounts.get(idDatabase) ?? 0) + 1;
              finishCounts.set(idDatabase, count);
              if (count === 2) throw databaseUnavailable();
              return originalFinish(executionId, patch);
            };
            const sessions = new MemorySessionRepository(repository);
            vi.spyOn(sessions, 'findExecutionByTurn').mockRejectedValue(databaseUnavailable());
            vi.spyOn(sessions, 'closeSession').mockRejectedValue(databaseUnavailable());
            sessionRepositories.set(idDatabase, sessions);
          } else {
            sessionRepositories.set(idDatabase, new MemorySessionRepository(repository));
          }
        }

        return new AgentRuntime({
          repository,
          sessionRepository: sessionRepositories.get(idDatabase),
          registry: agentRegistry,
          runner: {
            async run(agent) {
              return { finalOutput: { Intent: 'OK' }, lastAgent: { name: agent.name } };
            },
          },
          mcpServer: createFakeMcpServer(),
          observability: new McpObservabilityRegistry(),
          model: 'fake-model',
          tracingEnabled: false,
          traceIncludeSensitiveData: false,
        });
      },
    });

    const runController = createAgentController(gateway as unknown as Parameters<typeof createAgentController>[0]);
    const turnController = createAgentTurnController(gateway as unknown as Parameters<typeof createAgentTurnController>[0]);
    const closeController = createAgentSessionController(gateway as unknown as Parameters<typeof createAgentSessionController>[0]);
    const flowController = createFlowAssistController(gateway as unknown as Parameters<typeof createFlowAssistController>[0]);

    try {
      // The first Run validates the pool; the second fails at finishExecution
      // after the gateway reuses that same generation.
      expect(await invokeController(runController, runInput)).toMatchObject({ statusCode: 200, body: { Success: true } });
      const failedRun = await invokeController(runController, runInput);
      expect(failedRun).toMatchObject({
        statusCode: 503,
        body: { Success: false, Output: null, Error: { Code: 'TENANT_DATABASE_UNAVAILABLE', Message: SAFE_DATABASE_MESSAGE } },
      });

      const failedTurn = await invokeController(turnController, turnInput);
      expect(failedTurn).toMatchObject({
        statusCode: 503,
        body: { Success: false, TurnUUID: turnInput.TurnUUID, Error: { Code: 'TENANT_DATABASE_UNAVAILABLE', Message: SAFE_DATABASE_MESSAGE } },
      });

      const failedClose = await invokeController(closeController, { CompanyUUID: COMPANY_A, IdCompany: 45, IdProcessLine: 200 });
      expect(failedClose).toMatchObject({
        statusCode: 503,
        body: { Success: false, Error: { Code: 'TENANT_DATABASE_UNAVAILABLE', Message: SAFE_DATABASE_MESSAGE } },
      });

      for (const input of [
        { ...flowAssistInput, CompanyUUID: COMPANY_A, IdCompany: 45 },
        { ...flowAssistCheckInput, CompanyUUID: COMPANY_A, IdCompany: 45, Instructions: '' },
      ]) {
        const failedAssist = await invokeController(flowController, input);
        expect(failedAssist.statusCode).toBe(503);
        expect(JSON.stringify(failedAssist.body)).toContain('TENANT_DATABASE_UNAVAILABLE');
        if (input.Mode === 'CHECK') expect(failedAssist.body).toMatchObject({ Success: false, Mode: 'CHECK', Results: [] });
        else expect(failedAssist.body).toMatchObject({ Success: false, Proposals: [] });
        expect(JSON.stringify(failedAssist.body)).toContain(SAFE_DATABASE_MESSAGE);
      }

      expect(handleCreations).toBe(1);
      expect(healthQueries).toBe(1);

      // A different database remains operational after failures on tenant A.
      const healthyOtherDatabase = await invokeController(runController, {
        ...runInput,
        CompanyUUID: COMPANY_B,
        IdCompany: 55,
      });
      expect(healthyOtherDatabase).toMatchObject({ statusCode: 200, body: { Success: true } });
      expect(handleCreations).toBe(2);

      const publicBodies = [failedRun.body, failedTurn.body, failedClose.body];
      expect(JSON.stringify(publicBodies)).not.toMatch(/tenant\.internal|password=secret|private-parameter|SELECT \*|ECONNRESET/i);
    } finally {
      await connections.close();
    }
  });
});
