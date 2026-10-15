import { describe, expect, it, vi } from 'vitest';
import { TenantRuntimeGateway } from '../../src/api/TenantRuntimeGateway.js';
import { TenantError, TenantErrorCodes } from '../../src/tenancy/TenantError.js';
import type { TenantDescriptor } from '../../src/tenancy/TenantDescriptor.js';
import type { CentralRegistry } from '../../src/tenancy/CentralRegistry.js';
import type { TenantConnectionManager, TenantDatabaseLease } from '../../src/tenancy/ConnectionManager.js';
import type { RuntimeDatabase } from '../../src/database/connection.js';
import type { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import type { AgentRunInput } from '../../src/api/contracts/agentRunInput.js';
import { flowAssistCheckInput, flowAssistInput } from '../helpers/flowAssist.js';

const uuidA = 'd2719f62-8a67-4fd5-a6ae-411a6a3ef177';
const tenant: TenantDescriptor = {
  CompanyUUID: uuidA,
  IdDatabase: 10,
  IdCompany: 44,
  database: { host: 'db.internal', port: 3306, database: 'tenant_a', user: 'runtime', password: 'hidden' },
};

function makeGateway(options: {
  allowlist?: readonly string[];
  resolve?: (uuid: string) => Promise<TenantDescriptor>;
  run?: () => Promise<unknown>;
} = {}) {
  const resolve = vi.fn(options.resolve ?? (async () => tenant));
  const release = vi.fn(async () => undefined);
  const acquire = vi.fn(async () => ({ descriptor: tenant, db: {} as RuntimeDatabase, release } satisfies TenantDatabaseLease));
  const run = vi.fn(options.run ?? (async () => ({ statusCode: 200, response: { Success: true } })));
  const runtime = { run } as unknown as AgentRuntime;
  const gateway = new TenantRuntimeGateway({
    allowlist: options.allowlist ?? [uuidA],
    registry: { resolve } as unknown as CentralRegistry,
    connections: { acquire } as unknown as TenantConnectionManager,
    buildRuntime: () => runtime,
  });
  return { gateway, resolve, acquire, release, run };
}

const input: AgentRunInput = {
  CompanyUUID: uuidA.toUpperCase(),
  Agent: 'sales-agent',
  IdCompany: 44,
  IdChat: 100,
  IdProcessLine: 200,
  IdProcessLineFlow: 300,
  Message: 'hello',
  ExpectedOutput: { Name: 'Reply', Description: 'A short reply.' },
};

describe('tenant runtime gateway', () => {
  it('checks the allowlist before resolving the Registry', async () => {
    const { gateway, resolve, acquire } = makeGateway({ allowlist: [] });

    await expect(gateway.run(input)).rejects.toMatchObject({ statusCode: 403, code: 'TENANT_NOT_ALLOWED' });
    expect(resolve).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
  });

  it('normalizes the company UUID and rejects an IdCompany mismatch before pool acquisition', async () => {
    const { gateway, resolve, acquire } = makeGateway();

    await expect(gateway.run({ ...input, IdCompany: 45 })).rejects.toMatchObject({
      code: TenantErrorCodes.RegistryInconsistent,
    });
    expect(resolve).toHaveBeenCalledWith(uuidA);
    expect(acquire).not.toHaveBeenCalled();
  });

  it('holds a tenant lease through the full asynchronous runtime call', async () => {
    let finish!: (value: unknown) => void;
    const runtimePromise = new Promise<unknown>((resolve) => { finish = resolve; });
    const { gateway, release } = makeGateway({ run: () => runtimePromise });

    const execution = gateway.run(input);
    await Promise.resolve();
    await Promise.resolve();
    expect(gateway.getActiveRequestCount()).toBe(1);
    expect(release).not.toHaveBeenCalled();

    finish({ statusCode: 200, response: { Success: true } });
    await execution;
    expect(release).toHaveBeenCalledTimes(1);
    expect(gateway.getActiveRequestCount()).toBe(0);
  });

  it('preserves a completed response and drains the request when lease cleanup fails', async () => {
    const response = { statusCode: 200, response: { Success: true } };
    const release = vi.fn(async () => { throw new Error('contains connection details'); });
    const acquire = vi.fn(async () => ({ descriptor: tenant, db: {} as RuntimeDatabase, release } satisfies TenantDatabaseLease));
    const runtime = { run: vi.fn(async () => response) } as unknown as AgentRuntime;
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const gateway = new TenantRuntimeGateway({
      allowlist: [uuidA],
      registry: { resolve: vi.fn(async () => tenant) } as unknown as CentralRegistry,
      connections: { acquire } as unknown as TenantConnectionManager,
      buildRuntime: () => runtime,
    });

    try {
      await expect(gateway.run(input)).resolves.toBe(response);
      expect(gateway.getActiveRequestCount()).toBe(0);
      expect(errorLog).toHaveBeenCalledWith(JSON.stringify({
        Event: 'TENANT_POOL_RELEASE_FAILED',
        CompanyUUID: uuidA,
        IdDatabase: 10,
      }));
      expect(errorLog.mock.calls.flat().join(' ')).not.toContain('connection details');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('blocks new work during shutdown and reports whether accepted calls drained', async () => {
    let finish!: (value: unknown) => void;
    const runtimePromise = new Promise<unknown>((resolve) => { finish = resolve; });
    const { gateway } = makeGateway({ run: () => runtimePromise });

    const execution = gateway.run(input);
    await Promise.resolve();
    await Promise.resolve();
    gateway.stopAccepting();
    await expect(gateway.run(input)).rejects.toMatchObject({ code: TenantErrorCodes.ManagerClosed });
    expect(await gateway.waitForDrain(1)).toBe(false);

    finish({ statusCode: 200, response: { Success: true } });
    await execution;
    expect(await gateway.waitForDrain(100)).toBe(true);
  });

  it('keeps Registry failures typed so HTTP can return 503', async () => {
    const { gateway } = makeGateway({ resolve: async () => { throw new TenantError(TenantErrorCodes.RegistryUnavailable, 'Registry central indisponível.'); } });
    await expect(gateway.run(input)).rejects.toMatchObject({ code: TenantErrorCodes.RegistryUnavailable });
  });

  it('routes Runs, Turns, Session Close, PREFILL and CHECK through the resolved tenant lease', async () => {
    const db = {} as RuntimeDatabase;
    const release = vi.fn(async () => undefined);
    const acquire = vi.fn(async () => ({ descriptor: tenant, db, release } satisfies TenantDatabaseLease));
    const calls: Array<{ method: string; input: unknown }> = [];
    const runtime = {
      async run(value: unknown) { calls.push({ method: 'run', input: value }); return { statusCode: 200 }; },
      async runTurn(value: unknown) { calls.push({ method: 'runTurn', input: value }); return { statusCode: 200 }; },
      async closeSession(value: unknown) { calls.push({ method: 'closeSession', input: value }); return { statusCode: 200 }; },
      async runFlowAssist(value: unknown) { calls.push({ method: 'runFlowAssist', input: value }); return { statusCode: 200 }; },
    } as unknown as AgentRuntime;
    const gateway = new TenantRuntimeGateway({
      allowlist: [uuidA],
      registry: { resolve: vi.fn(async () => tenant) } as unknown as CentralRegistry,
      connections: { acquire } as unknown as TenantConnectionManager,
      buildRuntime: vi.fn((_descriptor, database) => {
        expect(database).toBe(db);
        return runtime;
      }),
    });
    const company = { CompanyUUID: uuidA, IdCompany: tenant.IdCompany };
    const turn = { ...company, TurnUUID: '14ed24ea-0000-4000-8000-000000000001' };
    const close = { ...company, IdProcessLine: 200 };
    const prefill = { ...flowAssistInput, ...company };
    const check = { ...flowAssistCheckInput, ...company };

    await gateway.run(input);
    await gateway.runTurn(turn as any);
    await gateway.closeSession(close as any);
    await gateway.runFlowAssist(prefill as any);
    await gateway.runFlowAssist(check as any);

    expect(calls.map((call) => call.method)).toEqual(['run', 'runTurn', 'closeSession', 'runFlowAssist', 'runFlowAssist']);
    expect(calls.map((call) => (call.input as { CompanyUUID?: string }).CompanyUUID)).toEqual([uuidA.toUpperCase(), ...Array(4).fill(uuidA)]);
    expect((calls[3]!.input as { Mode?: string }).Mode).toBeUndefined();
    expect((calls[4]!.input as { Mode?: string }).Mode).toBe('CHECK');
    expect(acquire).toHaveBeenCalledTimes(5);
    expect(release).toHaveBeenCalledTimes(5);
  });
});
