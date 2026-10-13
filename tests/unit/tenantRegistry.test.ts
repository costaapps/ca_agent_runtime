import { describe, expect, it } from 'vitest';
import { CentralRegistry } from '../../src/tenancy/CentralRegistry.js';
import { TenantError, TenantErrorCodes } from '../../src/tenancy/TenantError.js';

const COMPANY_UUID = 'd2719f62-8a67-4fd5-a6ae-411a6a3ef177';

function registryRow(overrides: Record<string, unknown> = {}) {
  return {
    CompanyUUID: COMPANY_UUID,
    IdDatabase: 12,
    IdCompany: 45,
    CompanyIdentityCount: 1,
    Hostname: 'tenant-db.internal',
    Port: 3306,
    DBName: 'company_db',
    Username: 'runtime',
    Password: 'private-secret',
    ...overrides,
  };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof TenantError ? error.code : undefined;
}

describe('CentralRegistry', () => {
  it('normalizes UUID and shares a single lookup for concurrent requests', async () => {
    let queryCount = 0;
    let finish!: (rows: unknown) => void;
    const delayed = new Promise<unknown>((resolve) => { finish = resolve; });
    const registry = new CentralRegistry({
      query: async (sql, values) => {
        expect(sql).toContain('LEFT JOIN `Databases`');
        expect(values).toEqual([COMPANY_UUID]);
        queryCount += 1;
        return delayed;
      },
    });

    const first = registry.resolve(` ${COMPANY_UUID.toUpperCase()} `);
    const second = registry.resolve(COMPANY_UUID);
    finish([registryRow()]);

    const [a, b] = await Promise.all([first, second]);
    expect(queryCount).toBe(1);
    expect(a).toBe(b);
    expect(a.CompanyUUID).toBe(COMPANY_UUID);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.database)).toBe(true);
    expect(a.database.password).toBe('private-secret');
    expect(JSON.stringify(a)).not.toContain('private-secret');
    expect(JSON.stringify(a)).toContain(COMPANY_UUID);
  });

  it('caches by UUID until TTL expires, then refreshes', async () => {
    let now = 100;
    let queryCount = 0;
    const registry = new CentralRegistry({
      cacheTtlMs: 50,
      now: () => now,
      query: async () => {
        queryCount += 1;
        return [registryRow({ DBName: `company_db_${queryCount}` })];
      },
    });

    const first = await registry.resolve(COMPANY_UUID);
    now = 149;
    expect(await registry.resolve(COMPANY_UUID)).toBe(first);
    now = 150;
    const refreshed = await registry.resolve(COMPANY_UUID);

    expect(queryCount).toBe(2);
    expect(refreshed.database.database).toBe('company_db_2');
  });

  it('invalidates sibling tenant descriptors when shared database credentials rotate', async () => {
    const siblingUUID = 'a9f18f14-670a-4f98-94d1-c609d575b423';
    let password = 'old-runtime-secret';
    let queryCount = 0;
    const registry = new CentralRegistry({
      cacheTtlMs: 60_000,
      query: async (_sql, values) => {
        queryCount += 1;
        const companyUUID = values?.[0] === siblingUUID ? siblingUUID : COMPANY_UUID;
        return [registryRow({
          CompanyUUID: companyUUID,
          IdCompany: companyUUID === COMPANY_UUID ? 45 : 46,
          Password: password,
        })];
      },
    });

    await registry.resolve(COMPANY_UUID);
    password = 'new-runtime-secret';
    const sibling = await registry.resolve(siblingUUID);
    const refreshed = await registry.resolve(COMPANY_UUID);

    expect(sibling.database.password).toBe('new-runtime-secret');
    expect(refreshed.database.password).toBe('new-runtime-secret');
    expect(queryCount).toBe(3);
  });

  it('returns a safe 503 when an expired descriptor cannot be refreshed', async () => {
    let now = 0;
    let fail = false;
    const registry = new CentralRegistry({
      cacheTtlMs: 10,
      now: () => now,
      query: async () => {
        if (fail) throw new Error('connection password=do-not-leak');
        return [registryRow()];
      },
    });

    await registry.resolve(COMPANY_UUID);
    now = 10;
    fail = true;
    await expect(registry.resolve(COMPANY_UUID)).rejects.toMatchObject({ code: TenantErrorCodes.RegistryUnavailable });
    await expect(registry.resolve(COMPANY_UUID)).rejects.not.toThrow('password=do-not-leak');
  });

  it('distinguishes unknown companies, duplicate entries, and inconsistent joins', async () => {
    const absent = new CentralRegistry({ query: async () => [] });
    await expect(absent.resolve(COMPANY_UUID)).rejects.toMatchObject({ code: TenantErrorCodes.NotFound });

    const duplicate = new CentralRegistry({ query: async () => [registryRow(), registryRow()] });
    await expect(duplicate.resolve(COMPANY_UUID)).rejects.toMatchObject({ code: TenantErrorCodes.RegistryInconsistent });

    const collidingCompanyIdentity = new CentralRegistry({ query: async () => [registryRow({
      CompanyUUID: COMPANY_UUID,
      CompanyIdentityCount: 2,
    })] });
    await expect(collidingCompanyIdentity.resolve(COMPANY_UUID)).rejects.toMatchObject({ code: TenantErrorCodes.RegistryInconsistent });

    const brokenJoin = new CentralRegistry({ query: async () => [registryRow({ DBName: null })] });
    await expect(brokenJoin.resolve(COMPANY_UUID)).rejects.toMatchObject({ code: TenantErrorCodes.RegistryInconsistent });
  });

  it('rejects invalid UUIDs before querying and never echoes the value', async () => {
    let queryCount = 0;
    const registry = new CentralRegistry({ query: async () => { queryCount += 1; return []; } });
    const invalidValue = 'secret-invalid-company-value';

    try {
      await registry.resolve(invalidValue);
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(errorCode(error)).toBe(TenantErrorCodes.InvalidCompanyUUID);
      expect((error as Error).message).not.toContain(invalidValue);
    }
    expect(queryCount).toBe(0);
  });

  it('exposes a safe Registry availability probe error', async () => {
    const registry = new CentralRegistry({ query: async () => { throw new Error('host=internal password=secret'); } });
    await expect(registry.checkAvailable()).rejects.toMatchObject({ code: TenantErrorCodes.RegistryUnavailable });
    await expect(registry.checkAvailable()).rejects.not.toThrow('password=secret');
  });
});
