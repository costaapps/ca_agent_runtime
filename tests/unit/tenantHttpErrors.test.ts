import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { createAgentController } from '../../src/api/controllers/agentController.js';
import { createAgentSessionController } from '../../src/api/controllers/agentSessionController.js';
import { createAgentTurnController } from '../../src/api/controllers/agentTurnController.js';
import { createFlowAssistController } from '../../src/api/controllers/flowAssistController.js';
import { ErrorCodes } from '../../src/errors/errorCodes.js';
import { asDatabaseRuntimeError, asRuntimeError, isDatabaseConnectivityError, RuntimeError, SAFE_PERSISTENCE_ERROR_MESSAGE, SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE } from '../../src/errors/RuntimeError.js';
import { getRuntimeHttpError } from '../../src/api/tenantErrors.js';
import { FlowAssistRuntime } from '../../src/runtime/FlowAssistRuntime.js';
import { KnowledgeSearchService } from '../../src/knowledge/KnowledgeSearchService.js';
import { EnvironmentProviderCredentialResolver } from '../../src/knowledge/credentials/EnvironmentProviderCredentialResolver.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { flowAssistCheckInput, flowAssistInput, flowAssistOutput } from '../helpers/flowAssist.js';

const runBody = {
  CompanyUUID: '14ed24ea-0000-4000-8000-000000000001', Agent: 'sales-agent', IdCompany: 1003,
  IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789, Message: 'Oi',
  ExpectedOutput: { Name: 'Intent', Description: 'Classifique.' },
};
const turnBody = {
  CompanyUUID: '14ed24ea-0000-4000-8000-000000000001', TurnUUID: '14ed24ea-0000-4000-8000-000000000611',
  Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, Messages: [{ IdMessage: 1, Text: 'Oi' }],
};
const closeBody = { CompanyUUID: runBody.CompanyUUID, IdCompany: 1003, IdProcessLine: 456 };

function codedError(message: string, code: string, errno?: number, sqlState?: string): Error {
  return Object.assign(new Error(message), { code, ...(errno === undefined ? {} : { errno }), ...(sqlState ? { sqlState } : {}) });
}

function drizzleWrappedConnectionError(): Error {
  const driverError = codedError('connect ECONNRESET mysql://user:secret@db/company?query=private', 'ECONNRESET');
  return new DrizzleQueryError('SELECT * FROM AIDocument', ['private-parameter'], driverError);
}

function drizzleWrappedIntegrityError(): Error {
  const driverError = codedError('Duplicate entry with secret SQL and parameters', 'ER_DUP_ENTRY', 1062, '23000');
  return new DrizzleQueryError('INSERT INTO AIDocument ...', ['secret-parameter'], driverError);
}

interface HttpResult { statusCode: number; body: unknown; }

async function invokeController(controller: (request: Request, response: Response) => Promise<void>, body: unknown): Promise<HttpResult> {
  const result: HttpResult = { statusCode: 0, body: undefined };
  const response = {
    status(statusCode: number) { result.statusCode = statusCode; return this; },
    json(value: unknown) { result.body = value; return this; },
  };
  await controller({ body } as Request, response as unknown as Response);
  return result;
}

function createFlowRuntime(repository: MemoryRepository, runner = vi.fn(async () => ({ finalOutput: flowAssistOutput as unknown }))) {
  return new FlowAssistRuntime({
    repository, registry: new AgentRegistry(), runner: { run: runner }, model: 'test-model', tracingEnabled: true,
    traceIncludeSensitiveData: false,
    knowledgeSearchService: new KnowledgeSearchService({ search: vi.fn().mockResolvedValue([]) }, new EnvironmentProviderCredentialResolver({ OPENAI_API_KEY: 'test-key' })),
  });
}

describe('tenant database HTTP errors', () => {
  it('classifies MySQL connection loss nested inside a Drizzle-style cause chain', () => {
    const error = new RuntimeError(ErrorCodes.PersistenceError, 'SQL and credentials leaked', drizzleWrappedConnectionError());
    expect(isDatabaseConnectivityError(error)).toBe(true);
    expect(asRuntimeError(error)).toMatchObject({ code: ErrorCodes.TenantDatabaseUnavailable, message: SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE });
    expect(getRuntimeHttpError(error)).toEqual({
      statusCode: 503, code: 'TENANT_DATABASE_UNAVAILABLE', message: SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE,
    });
  });

  it('only treats generic socket failures as tenant outages at an explicit database boundary', () => {
    const providerError = codedError('OpenAI request ECONNRESET', 'ECONNRESET', -4077);
    expect(isDatabaseConnectivityError(providerError)).toBe(false);
    expect(asRuntimeError(providerError, ErrorCodes.AgentExecutionError).code).toBe(ErrorCodes.AgentExecutionError);
    expect(asDatabaseRuntimeError(providerError)).toMatchObject({
      code: ErrorCodes.TenantDatabaseUnavailable, message: SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE,
    });
  });

  it('keeps schema and integrity failures as sanitized persistence errors', () => {
    const error = new RuntimeError(ErrorCodes.PersistenceError, 'INSERT ... secret value', drizzleWrappedIntegrityError());
    expect(isDatabaseConnectivityError(error)).toBe(false);
    expect(asRuntimeError(error)).toMatchObject({ code: ErrorCodes.PersistenceError, message: SAFE_PERSISTENCE_ERROR_MESSAGE });
    expect(getRuntimeHttpError(error)).toEqual({
      statusCode: 500, code: ErrorCodes.PersistenceError, message: SAFE_PERSISTENCE_ERROR_MESSAGE,
    });
    expect(JSON.stringify(getRuntimeHttpError(error))).not.toMatch(/secret|INSERT|parameters|AIDocument/i);
  });

  it('preserves the run, turn, and close envelopes while returning a safe 503', async () => {
    const failure = new RuntimeError(ErrorCodes.PersistenceError, 'SQL secret', drizzleWrappedConnectionError());
    const run = await invokeController(createAgentController({ run: vi.fn().mockRejectedValue(failure) } as never), runBody);
    const turn = await invokeController(createAgentTurnController({ runTurn: vi.fn().mockRejectedValue(failure) } as never), turnBody);
    const close = await invokeController(createAgentSessionController({ closeSession: vi.fn().mockRejectedValue(failure) } as never), closeBody);

    expect(run).toEqual({ statusCode: 503, body: { Success: false, Output: null, Error: { Code: 'TENANT_DATABASE_UNAVAILABLE', Message: SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE } } });
    expect(turn).toEqual({ statusCode: 503, body: { Success: false, TurnUUID: turnBody.TurnUUID, Error: { Code: 'TENANT_DATABASE_UNAVAILABLE', Message: SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE } } });
    expect(close).toEqual({ statusCode: 503, body: { Success: false, Error: { Code: 'TENANT_DATABASE_UNAVAILABLE', Message: SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE } } });
    expect(JSON.stringify([run, turn, close])).not.toMatch(/SQL secret|ECONNRESET|mysql:\/\//i);
  });

  it('keeps integrity errors as PERSISTENCE_ERROR with sanitized HTTP envelopes', async () => {
    const failure = new RuntimeError(ErrorCodes.PersistenceError, 'INSERT secret SQL and parameters', drizzleWrappedIntegrityError());
    const run = await invokeController(createAgentController({ run: vi.fn().mockRejectedValue(failure) } as never), runBody);
    const turn = await invokeController(createAgentTurnController({ runTurn: vi.fn().mockRejectedValue(failure) } as never), turnBody);
    const close = await invokeController(createAgentSessionController({ closeSession: vi.fn().mockRejectedValue(failure) } as never), closeBody);

    for (const response of [run, turn, close]) {
      expect(response.statusCode).toBe(500);
      expect((response.body as { Error: { Code: string; Message: string } }).Error.Code).toBe(ErrorCodes.PersistenceError);
      expect(JSON.stringify(response)).not.toMatch(/INSERT|secret|parameters|AIDocument/i);
    }
  });

  it.each([
    ['PREFILL', flowAssistInput, { Success: false, Proposals: [], Error: { Code: 'TENANT_DATABASE_UNAVAILABLE', Message: SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE } }],
    ['CHECK', { ...flowAssistCheckInput, Instructions: '' }, { Success: false, Mode: 'CHECK', Results: [], Error: { Code: 'TENANT_DATABASE_UNAVAILABLE', Message: SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE } }],
  ] as const)('preserves the Flow Assist %s envelope on database failure', async (_mode, input, expectedBody) => {
    const response = await invokeController(createFlowAssistController({
      runFlowAssist: vi.fn().mockRejectedValue(drizzleWrappedConnectionError()),
    } as never), input);
    expect(response).toEqual({ statusCode: 503, body: expectedBody });
    expect(JSON.stringify(response)).not.toMatch(/SQL|mysql|ECONNRESET|private/i);
  });

  it.each([
    ['PREFILL', flowAssistInput, { Success: false, Proposals: [], Error: { Code: 'TENANT_DATABASE_UNAVAILABLE', Message: SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE } }],
    ['CHECK', { ...flowAssistCheckInput, Instructions: '' }, { Success: false, Mode: 'CHECK', Results: [], Error: { Code: 'TENANT_DATABASE_UNAVAILABLE', Message: SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE } }],
  ] as const)('Flow Assist runtime returns a sanitized 503 for %s persistence access', async (_mode, input, expected) => {
    const repository = new MemoryRepository();
    vi.spyOn(repository, 'createExecution').mockRejectedValue(drizzleWrappedConnectionError());
    const result = await createFlowRuntime(repository).runFlowAssist(input);
    expect(result.statusCode).toBe(503);
    expect(result.response).toMatchObject(expected);
    expect('ExecutionUUID' in result.response ? result.response.ExecutionUUID : undefined).toEqual(expect.any(String));
    expect(JSON.stringify(result.response)).not.toMatch(/SQL|mysql|ECONNRESET|private/i);
  });

  it('returns a sanitized PERSISTENCE_ERROR for Flow Assist integrity failures', async () => {
    const repository = new MemoryRepository();
    vi.spyOn(repository, 'createExecution').mockRejectedValue(drizzleWrappedIntegrityError());
    const result = await createFlowRuntime(repository).runFlowAssist(flowAssistInput);
    expect(result).toMatchObject({
      statusCode: 500,
      response: { Success: false, Error: { Code: ErrorCodes.PersistenceError, Message: 'Não foi possível concluir o Agent Assist.' } },
    });
    expect(JSON.stringify(result.response)).not.toMatch(/secret|INSERT|parameters|AIDocument/i);
  });

  it('keeps an independent tenant call operational after another tenant returns 503', async () => {
    const controller = createAgentController({
      run: vi.fn(async (input: typeof runBody) => {
        if (input.IdCompany === 1003) throw drizzleWrappedConnectionError();
        return { statusCode: 200 as const, response: { Success: true, ExecutionUUID: 'other-tenant', Output: { Intent: 'ok' } } };
      }),
    } as never);

    const unavailable = await invokeController(controller, runBody);
    const healthy = await invokeController(controller, {
      ...runBody, CompanyUUID: '14ed24ea-0000-4000-8000-000000000002', IdCompany: 2003,
    });
    expect(unavailable.statusCode).toBe(503);
    expect(healthy).toMatchObject({ statusCode: 200, body: { Success: true, ExecutionUUID: 'other-tenant' } });
  });
});
