import { describe, expect, it } from 'vitest';
import type { RuntimeDatabase } from '../../src/database/connection.js';
import { TenantConnectionManager, type TenantDatabaseHandle } from '../../src/tenancy/ConnectionManager.js';
import { createTenantDescriptor, type TenantDescriptor } from '../../src/tenancy/TenantDescriptor.js';
import { TenantError, TenantErrorCodes } from '../../src/tenancy/TenantError.js';

const COMPANY_UUID = 'd2719f62-8a67-4fd5-a6ae-411a6a3ef177';

function descriptor(idDatabase: number, overrides: Partial<TenantDescriptor['database']> = {}): TenantDescriptor {
  return createTenantDescriptor({
    CompanyUUID: COMPANY_UUID,
    IdDatabase: idDatabase,
    IdCompany: idDatabase * 10,
    database: {
      host: 'tenant-db.internal',
      port: 3306,
      database: `company_${idDatabase}`,
      user: 'runtime',
      password: 'never-log-this',
      ...overrides,
    },
  });
}

function fakeHandle(options: { failProbe?: boolean } = {}): TenantDatabaseHandle & { ended: { count: number } } {
  const ended = { count: 0 };
  const db = {} as RuntimeDatabase;
  return {
    db,
    ended,
    pool: {
      query: async () => {
        if (options.failProbe) throw new Error('user=runtime password=never-log-this');
        return [[{ ok: 1 }], []];
      },
      end: async () => { ended.count += 1; },
    },
  };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof TenantError ? error.code : undefined;
}

describe('TenantConnectionManager', () => {
  it('single-flights pool creation and leases one shared Drizzle handle', async () => {
    let createCount = 0;
    let finishCreate!: (handle: TenantDatabaseHandle) => void;
    const createGate = new Promise<TenantDatabaseHandle>((resolve) => { finishCreate = resolve; });
    const manager = new TenantConnectionManager({
      sweepIntervalMs: 0,
      createHandle: async () => {
        createCount += 1;
        return createGate;
      },
    });

    const firstPromise = manager.acquire(descriptor(9));
    const secondPromise = manager.acquire(descriptor(9));
    const handle = fakeHandle();
    finishCreate(handle);
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(createCount).toBe(1);
    expect(first.db).toBe(second.db);
    expect(manager.getStats()).toEqual({ poolCount: 1, activeLeases: 2, drainingPoolCount: 0 });
    await Promise.all([first.release(), second.release()]);
    expect(handle.ended.count).toBe(0);
    await manager.close();
    expect(handle.ended.count).toBe(1);
  });

  it('keeps every waiter pinned when a slower generation retires during credential rotation', async () => {
    const oldHandle = fakeHandle();
    const newHandle = fakeHandle();
    let finishOld!: (handle: TenantDatabaseHandle) => void;
    let finishNew!: (handle: TenantDatabaseHandle) => void;
    const oldGate = new Promise<TenantDatabaseHandle>((resolve) => { finishOld = resolve; });
    const newGate = new Promise<TenantDatabaseHandle>((resolve) => { finishNew = resolve; });
    const manager = new TenantConnectionManager({
      sweepIntervalMs: 0,
      createHandle: (config) => config.password === 'old' ? oldGate : newGate,
    });

    const firstOld = manager.acquire(descriptor(19, { password: 'old' }));
    const secondOld = manager.acquire(descriptor(19, { password: 'old' }));
    const rotated = manager.acquire(descriptor(19, { password: 'new' }));
    finishNew(newHandle);
    const newLease = await rotated;
    finishOld(oldHandle);
    const [firstLease, secondLease] = await Promise.all([firstOld, secondOld]);

    expect(manager.getStats()).toEqual({ poolCount: 2, activeLeases: 3, drainingPoolCount: 1 });
    await firstLease.release();
    expect(oldHandle.ended.count).toBe(0);
    await secondLease.release();
    expect(oldHandle.ended.count).toBe(1);
    await newLease.release();
    await manager.close();
    expect(newHandle.ended.count).toBe(1);
  });

  it('shares a pool across companies that resolve to the same database and credentials', async () => {
    let createCount = 0;
    const handle = fakeHandle();
    const manager = new TenantConnectionManager({
      sweepIntervalMs: 0,
      createHandle: () => { createCount += 1; return handle; },
    });
    const first = await manager.acquire(descriptor(4));
    const second = await manager.acquire(createTenantDescriptor({
      CompanyUUID: 'a9f18f14-670a-4f98-94d1-c609d575b423',
      IdDatabase: 4,
      IdCompany: 200,
      database: descriptor(4).database,
    }));

    expect(createCount).toBe(1);
    expect(first.db).toBe(second.db);
    await first.release();
    await second.release();
    await manager.close();
  });

  it('retires a rotated pool only after its existing execution leases release', async () => {
    const handles: Array<ReturnType<typeof fakeHandle>> = [];
    const manager = new TenantConnectionManager({
      sweepIntervalMs: 0,
      createHandle: () => {
        const handle = fakeHandle();
        handles.push(handle);
        return handle;
      },
    });
    const oldLease = await manager.acquire(descriptor(17));
    const newLease = await manager.acquire(descriptor(17, { password: 'rotated-secret' }));

    expect(handles).toHaveLength(2);
    expect(handles[0]?.ended.count).toBe(0);
    expect(manager.getStats()).toEqual({ poolCount: 2, activeLeases: 2, drainingPoolCount: 1 });
    await oldLease.release();
    expect(handles[0]?.ended.count).toBe(1);
    expect(manager.getStats()).toEqual({ poolCount: 1, activeLeases: 1, drainingPoolCount: 0 });
    await newLease.release();
    await manager.close();
    expect(handles[1]?.ended.count).toBe(1);
  });

  it('evicts the least recently used idle pool at capacity, but rejects when all pools are leased', async () => {
    let now = 0;
    const handles: Array<ReturnType<typeof fakeHandle>> = [];
    const manager = new TenantConnectionManager({
      maxPools: 1,
      idleTimeoutMs: 100,
      sweepIntervalMs: 0,
      now: () => now,
      createHandle: () => {
        const handle = fakeHandle();
        handles.push(handle);
        return handle;
      },
    });
    const held = await manager.acquire(descriptor(1));
    await expect(manager.acquire(descriptor(2))).rejects.toMatchObject({ code: TenantErrorCodes.PoolCapacity });
    await held.release();
    now += 100;
    const replacement = await manager.acquire(descriptor(2));

    expect(handles[0]?.ended.count).toBe(1);
    expect(manager.getStats().poolCount).toBe(1);
    await replacement.release();
    await manager.close();
  });

  it('counts pools still being created against the hard pool limit', async () => {
    let finishCreate!: (handle: TenantDatabaseHandle) => void;
    const createGate = new Promise<TenantDatabaseHandle>((resolve) => { finishCreate = resolve; });
    const manager = new TenantConnectionManager({
      maxPools: 1,
      sweepIntervalMs: 0,
      createHandle: () => createGate,
    });
    const firstPromise = manager.acquire(descriptor(20));

    await expect(manager.acquire(descriptor(21))).rejects.toMatchObject({ code: TenantErrorCodes.PoolCapacity });
    const lease = await Promise.resolve().then(() => {
      const handle = fakeHandle();
      finishCreate(handle);
      return firstPromise;
    });
    await lease.release();
    await manager.close();
  });

  it('returns a sanitized database error and closes an unpublishable pool', async () => {
    const handle = fakeHandle({ failProbe: true });
    const manager = new TenantConnectionManager({ sweepIntervalMs: 0, createHandle: () => handle });

    try {
      await manager.acquire(descriptor(8));
      throw new Error('expected connection to fail');
    } catch (error) {
      expect(errorCode(error)).toBe(TenantErrorCodes.DatabaseUnavailable);
      expect((error as Error).message).not.toContain('never-log-this');
    }
    expect(handle.ended.count).toBe(1);
    expect(manager.getStats().poolCount).toBe(0);
    await manager.close();
  });

  it('waits for leases to drain before close resolves and makes release idempotent', async () => {
    const handle = fakeHandle();
    const manager = new TenantConnectionManager({ sweepIntervalMs: 0, createHandle: () => handle });
    const lease = await manager.acquire(descriptor(3));
    let closeFinished = false;
    const closing = manager.close().then(() => { closeFinished = true; });
    await Promise.resolve();
    expect(closeFinished).toBe(false);
    await lease.release();
    await lease.release();
    await closing;
    expect(handle.ended.count).toBe(1);
    expect(manager.getStats().poolCount).toBe(0);
    await expect(manager.acquire(descriptor(3))).rejects.toMatchObject({ code: TenantErrorCodes.ManagerClosed });
  });

  it('does not expose configuration fingerprints in aggregate stats', async () => {
    const manager = new TenantConnectionManager({ sweepIntervalMs: 0, createHandle: () => fakeHandle() });
    const lease = await manager.acquire(descriptor(5));
    expect(JSON.stringify(manager.getStats())).not.toContain('never-log-this');
    await lease.release();
    await manager.close();
  });
});
