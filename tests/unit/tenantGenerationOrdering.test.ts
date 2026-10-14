import { describe, expect, it } from 'vitest';
import type { RuntimeDatabase } from '../../src/database/connection.js';
import { TenantConnectionManager, type TenantDatabaseHandle } from '../../src/tenancy/ConnectionManager.js';
import { CentralRegistry } from '../../src/tenancy/CentralRegistry.js';

const OLDER_COMPANY_UUID = 'd2719f62-8a67-4fd5-a6ae-411a6a3ef177';
const NEWER_COMPANY_UUID = 'a9f18f14-670a-4f98-94d1-c609d575b423';

function registryRow(companyUUID: string, idCompany: number, password: string) {
  return {
    CompanyUUID: companyUUID,
    IdDatabase: 12,
    IdCompany: idCompany,
    CompanyIdentityCount: 1,
    Hostname: 'tenant-db.internal',
    Port: 3306,
    DBName: 'shared_company_db',
    Username: 'runtime',
    Password: password,
  };
}

describe('Registry configuration ordering across tenant pool generations', () => {
  it('keeps a late old lookup on its own lease without displacing the latest pool', async () => {
    let finishOlderLookup!: (rows: unknown) => void;
    const olderLookupGate = new Promise<unknown>((resolve) => { finishOlderLookup = resolve; });
    const registry = new CentralRegistry({
      cacheTtlMs: 0,
      query: async (_sql, values) => {
        const companyUUID = String(values?.[0]);
        if (companyUUID === OLDER_COMPANY_UUID) return olderLookupGate;
        return [registryRow(NEWER_COMPANY_UUID, 46, 'new-config')];
      },
    });

    // The older lookup starts first but is intentionally completed after the newer one.
    const olderResolution = registry.resolve(OLDER_COMPANY_UUID);
    const newerDescriptor = await registry.resolve(NEWER_COMPANY_UUID);
    const opened: Array<{
      password: string;
      handle: TenantDatabaseHandle & { ended: { count: number } };
    }> = [];
    const manager = new TenantConnectionManager({
      maxPools: 2,
      sweepIntervalMs: 0,
      createHandle: (config) => {
        const ended = { count: 0 };
        const entry = {
          password: config.password,
          handle: {
            db: {} as RuntimeDatabase,
            ended,
            pool: {
              query: async () => [[{ ok: 1 }], []],
              end: async () => { ended.count += 1; },
            },
          } as TenantDatabaseHandle & { ended: { count: number } },
        };
        opened.push(entry);
        return entry.handle;
      },
    });

    const newLease = await manager.acquire(newerDescriptor);
    finishOlderLookup([registryRow(OLDER_COMPANY_UUID, 45, 'old-config')]);
    const olderDescriptor = await olderResolution;
    const oldLease = await manager.acquire(olderDescriptor);

    expect(newerDescriptor.IdDatabase).toBe(olderDescriptor.IdDatabase);
    expect(newerDescriptor.IdCompany).not.toBe(olderDescriptor.IdCompany);
    expect(olderDescriptor.database.password).toBe('old-config');
    expect(JSON.stringify(olderDescriptor)).not.toContain('old-config');
    expect(opened.map(({ password }) => password)).toEqual(['new-config', 'old-config']);
    expect(manager.getStats()).toEqual({ poolCount: 2, activeLeases: 2, drainingPoolCount: 1 });

    // A new request using the latest Registry result reuses its already leased generation.
    const nextNewLease = await manager.acquire(newerDescriptor);
    expect(nextNewLease.db).toBe(newLease.db);
    expect(opened).toHaveLength(2);
    expect(manager.getStats()).toEqual({ poolCount: 2, activeLeases: 3, drainingPoolCount: 1 });
    expect(opened[0]?.handle.ended.count).toBe(0);
    expect(opened[1]?.handle.ended.count).toBe(0);

    await oldLease.release();
    expect(opened[1]?.handle.ended.count).toBe(1);
    expect(opened[0]?.handle.ended.count).toBe(0);
    expect(manager.getStats()).toEqual({ poolCount: 1, activeLeases: 2, drainingPoolCount: 0 });

    await newLease.release();
    expect(opened[0]?.handle.ended.count).toBe(0);
    await nextNewLease.release();
    await manager.close();
    expect(opened[0]?.handle.ended.count).toBe(1);
    expect(manager.getStats()).toEqual({ poolCount: 0, activeLeases: 0, drainingPoolCount: 0 });
  });
});
