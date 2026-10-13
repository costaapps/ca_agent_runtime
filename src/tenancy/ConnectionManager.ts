import { createHash } from 'node:crypto';
import mysql, { type Pool } from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../database/schema/index.js';
import type { RuntimeDatabase } from '../database/connection.js';
import type { TenantDatabaseConfig, TenantDescriptor } from './TenantDescriptor.js';
import { TenantError, TenantErrorCodes } from './TenantError.js';

interface PoolLike {
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

export interface TenantDatabaseHandle {
  readonly db: RuntimeDatabase;
  readonly pool: PoolLike;
}

export interface TenantDatabaseLease {
  readonly descriptor: TenantDescriptor;
  readonly db: RuntimeDatabase;
  release(): Promise<void>;
}

export interface TenantConnectionManagerOptions {
  readonly connectionLimit?: number;
  readonly maxPools?: number;
  readonly idleTimeoutMs?: number;
  readonly sweepIntervalMs?: number;
  readonly now?: () => number;
  readonly createHandle?: (config: TenantDatabaseConfig, connectionLimit: number) => TenantDatabaseHandle | Promise<TenantDatabaseHandle>;
}

interface PoolGeneration extends TenantDatabaseHandle {
  readonly idDatabase: number;
  readonly fingerprint: string;
  readonly createdAt: number;
  lastUsedAt: number;
  leases: number;
  waitingAcquires: number;
  retiring: boolean;
  closing?: Promise<void>;
}

interface PendingGeneration {
  readonly key: string;
  waiters: number;
  generation?: PoolGeneration;
  promise: Promise<PoolGeneration>;
}

const DEFAULT_CONNECTION_LIMIT = 8;
const DEFAULT_MAX_POOLS = 32;
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

/**
 * Shares tenant pools by physical database and connection configuration.
 * A lease pins a generation until the entire request has finished.
 */
export class TenantConnectionManager {
  private readonly currentByDatabase = new Map<number, PoolGeneration>();
  private readonly generations = new Set<PoolGeneration>();
  private readonly pending = new Map<string, PendingGeneration>();
  private readonly reservations = new Set<symbol>();
  private readonly desiredFingerprintByDatabase = new Map<number, string>();
  private readonly now: () => number;
  private readonly connectionLimit: number;
  private readonly maxPools: number;
  private readonly idleTimeoutMs: number;
  private readonly createHandle: NonNullable<TenantConnectionManagerOptions['createHandle']>;
  private readonly emptyWaiters = new Set<() => void>();
  private capacityTail: Promise<void> = Promise.resolve();
  private readonly sweepTimer?: ReturnType<typeof setInterval>;
  private closed = false;
  private closePromise?: Promise<void>;

  constructor(options: TenantConnectionManagerOptions = {}) {
    this.connectionLimit = options.connectionLimit ?? DEFAULT_CONNECTION_LIMIT;
    this.maxPools = options.maxPools ?? DEFAULT_MAX_POOLS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.createHandle = options.createHandle ?? defaultCreateHandle;

    if (!Number.isSafeInteger(this.connectionLimit) || this.connectionLimit <= 0) {
      throw new TypeError('connectionLimit deve ser um inteiro positivo.');
    }
    if (!Number.isSafeInteger(this.maxPools) || this.maxPools <= 0) {
      throw new TypeError('maxPools deve ser um inteiro positivo.');
    }
    if (!Number.isFinite(this.idleTimeoutMs) || this.idleTimeoutMs < 0) {
      throw new TypeError('idleTimeoutMs deve ser um número não negativo.');
    }

    const sweepIntervalMs = options.sweepIntervalMs ?? Math.min(this.idleTimeoutMs || 60_000, 60_000);
    if (sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => {
        void this.evictIdle().catch(() => undefined);
      }, sweepIntervalMs);
      this.sweepTimer.unref?.();
    }
  }

  async acquire(descriptor: TenantDescriptor): Promise<TenantDatabaseLease> {
    if (this.closed) throw new TenantError(TenantErrorCodes.ManagerClosed, 'Gerenciador de conexões encerrado.');

    const fingerprint = connectionFingerprint(descriptor.database);
    const databaseId = descriptor.IdDatabase;
    // The most recently resolved configuration wins publication. Older requests can
    // still finish on their own generation, which is retired after their leases drain.
    this.desiredFingerprintByDatabase.set(databaseId, fingerprint);

    const current = this.currentByDatabase.get(databaseId);
    if (current && !current.retiring && current.fingerprint === fingerprint) {
      return this.lease(current, descriptor);
    }

    const key = `${databaseId}:${fingerprint}`;
    let pending = this.pending.get(key);
    if (!pending) {
      pending = { key, waiters: 0, promise: Promise.resolve(undefined as never) };
      this.pending.set(key, pending);
      pending.promise = this.createGeneration(descriptor, fingerprint, pending);
    }
    pending.waiters += 1;
    // A request can join after the creation promise has resolved but before its
    // existing callers have removed the pending entry. Keep the generation
    // pinned for that late waiter as well.
    if (pending.generation) pending.generation.waitingAcquires += 1;

    let waiting = true;
    let generation: PoolGeneration | undefined;
    const releaseWaitingPin = (): void => {
      if (!waiting) return;
      waiting = false;
      pending!.waiters -= 1;
      if (generation) generation.waitingAcquires -= 1;
    };

    try {
      generation = await pending.promise;
      if (this.closed) {
        releaseWaitingPin();
        await this.maybeClose(generation);
        throw new TenantError(TenantErrorCodes.ManagerClosed, 'Gerenciador de conexões encerrado.');
      }
      if (generation.closing) {
        releaseWaitingPin();
        throw new TenantError(TenantErrorCodes.DatabaseUnavailable, 'Conexão da empresa indisponível.');
      }
      const lease = this.lease(generation, descriptor);
      releaseWaitingPin();
      if (generation.retiring) void this.maybeClose(generation).catch(() => undefined);
      this.cleanupPending(pending);
      return lease;
    } catch (error) {
      releaseWaitingPin();
      if (generation) void this.maybeClose(generation).catch(() => undefined);
      this.cleanupPending(pending);
      throw error;
    }
  }

  /** Close idle generations whose last lease has exceeded the configured TTL. */
  async evictIdle(now = this.now()): Promise<number> {
    const expired = [...this.generations]
      .filter((generation) => !generation.retiring
        && !generation.closing
        && generation.leases === 0
        && generation.waitingAcquires === 0
        && now - generation.lastUsedAt >= this.idleTimeoutMs)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt);

    let evicted = 0;
    for (const generation of expired) {
      await this.retire(generation);
      evicted += 1;
    }
    return evicted;
  }

  /** Aggregate-only counters for health endpoints; no tenant IDs or fingerprints. */
  getStats(): { poolCount: number; activeLeases: number; drainingPoolCount: number } {
    let activeLeases = 0;
    let drainingPoolCount = 0;
    for (const generation of this.generations) {
      activeLeases += generation.leases;
      if (generation.retiring) drainingPoolCount += 1;
    }
    return { poolCount: this.generations.size, activeLeases, drainingPoolCount };
  }

  /** Stop new acquisitions, retire all generations, then wait for leases to release. */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const generation of [...this.generations]) this.retireWithoutWaiting(generation);

    const pendingPromises = [...this.pending.values()].map((entry) => entry.promise.catch(() => undefined));
    this.closePromise = (async () => {
      await Promise.all(pendingPromises);
      for (const generation of [...this.generations]) this.retireWithoutWaiting(generation);
      if (this.generations.size === 0) return;
      await new Promise<void>((resolve) => this.emptyWaiters.add(resolve));
    })();
    return this.closePromise;
  }

  private async createGeneration(
    descriptor: TenantDescriptor,
    fingerprint: string,
    pending: PendingGeneration,
  ): Promise<PoolGeneration> {
    const reservation = await this.reserveCapacity();
    let handle: TenantDatabaseHandle | undefined;
    try {
      if (this.closed) throw new TenantError(TenantErrorCodes.ManagerClosed, 'Gerenciador de conexões encerrado.');
      handle = await this.createHandle(descriptor.database, this.connectionLimit);
      await handle.pool.query('SELECT 1');
    } catch {
      if (handle) {
        try { await handle.pool.end(); } catch { /* Keep failure details out of diagnostics. */ }
      }
      this.reservations.delete(reservation);
      this.notifyEmptyIfNeeded();
      if (this.closed) throw new TenantError(TenantErrorCodes.ManagerClosed, 'Gerenciador de conexões encerrado.');
      throw new TenantError(TenantErrorCodes.DatabaseUnavailable, 'Não foi possível conectar à base da empresa.');
    }

    this.reservations.delete(reservation);
    if (this.closed) {
      try { await handle.pool.end(); } catch { /* Keep failure details out of diagnostics. */ }
      throw new TenantError(TenantErrorCodes.ManagerClosed, 'Gerenciador de conexões encerrado.');
    }
    const now = this.now();
    const generation: PoolGeneration = {
      ...handle,
      idDatabase: descriptor.IdDatabase,
      fingerprint,
      createdAt: now,
      lastUsedAt: now,
      leases: 0,
      waitingAcquires: pending.waiters,
      retiring: false,
    };
    pending.generation = generation;
    this.generations.add(generation);

    if (this.desiredFingerprintByDatabase.get(descriptor.IdDatabase) === fingerprint) {
      const previous = this.currentByDatabase.get(descriptor.IdDatabase);
      this.currentByDatabase.set(descriptor.IdDatabase, generation);
      if (previous && previous !== generation) this.retireWithoutWaiting(previous);
    } else {
      // A newer descriptor arrived while this pool was being created. It may serve
      // the already accepted request(s), but it must not become the current generation.
      generation.retiring = true;
    }
    return generation;
  }

  private async reserveCapacity(): Promise<symbol> {
    let release!: () => void;
    const previous = this.capacityTail;
    this.capacityTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      while (true) {
        if (this.closed) throw new TenantError(TenantErrorCodes.ManagerClosed, 'Gerenciador de conexões encerrado.');
        if (this.generations.size + this.reservations.size < this.maxPools) {
          const token = Symbol('pool-reservation');
          this.reservations.add(token);
          return token;
        }

        const idle = [...this.generations]
          .filter((generation) => !generation.retiring
            && !generation.closing
            && generation.leases === 0
            && generation.waitingAcquires === 0)
          .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0];
        if (idle) {
          await this.retire(idle);
          continue;
        }

        const closing = [...this.generations].filter((generation) => generation.closing).map((generation) => generation.closing!);
        if (closing.length > 0) {
          await Promise.allSettled(closing);
          continue;
        }
        throw new TenantError(TenantErrorCodes.PoolCapacity, 'Limite de pools de empresas atingido.');
      }
    } finally {
      release();
    }
  }

  private lease(generation: PoolGeneration, descriptor: TenantDescriptor): TenantDatabaseLease {
    if (generation.closing || generation.retiring) {
      // A generation marked for drain remains available only to callers that were
      // already waiting for its creation; a later request gets a fresh generation.
      if (generation.waitingAcquires <= 0) {
        throw new TenantError(TenantErrorCodes.DatabaseUnavailable, 'Conexão da empresa indisponível.');
      }
    }
    generation.leases += 1;
    generation.lastUsedAt = this.now();
    let released = false;
    return {
      descriptor,
      db: generation.db,
      release: async () => {
        if (released) return;
        released = true;
        generation.leases -= 1;
        generation.lastUsedAt = this.now();
        await this.maybeClose(generation);
      },
    };
  }

  private async retire(generation: PoolGeneration): Promise<void> {
    this.retireWithoutWaiting(generation);
    await this.maybeClose(generation);
  }

  private retireWithoutWaiting(generation: PoolGeneration): void {
    generation.retiring = true;
    if (this.currentByDatabase.get(generation.idDatabase) === generation) {
      this.currentByDatabase.delete(generation.idDatabase);
    }
    void this.maybeClose(generation).catch(() => undefined);
  }

  private maybeClose(generation: PoolGeneration): Promise<void> {
    if (!generation.retiring || generation.leases > 0 || generation.waitingAcquires > 0) return Promise.resolve();
    if (generation.closing) return generation.closing;
    generation.closing = (async () => {
      try {
        await generation.pool.end();
      } catch {
        throw new TenantError(TenantErrorCodes.DatabaseUnavailable, 'Falha ao encerrar uma conexão de empresa.');
      } finally {
        this.generations.delete(generation);
        this.notifyEmptyIfNeeded();
      }
    })();
    // Rotation and release can trigger cleanup without an awaiting caller.
    void generation.closing.catch(() => undefined);
    return generation.closing;
  }

  private cleanupPending(pending: PendingGeneration): void {
    if (pending.waiters <= 0 && this.pending.get(pending.key) === pending) this.pending.delete(pending.key);
  }

  private notifyEmptyIfNeeded(): void {
    if (this.generations.size !== 0) return;
    for (const resolve of this.emptyWaiters) resolve();
    this.emptyWaiters.clear();
  }
}

function connectionFingerprint(config: TenantDatabaseConfig): string {
  const canonical = JSON.stringify([config.host, config.port, config.database, config.user, config.password]);
  return createHash('sha256').update(canonical).digest('hex');
}

function defaultCreateHandle(config: TenantDatabaseConfig, connectionLimit: number): TenantDatabaseHandle {
  const pool: Pool = mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionLimit,
    namedPlaceholders: true,
    waitForConnections: true,
  });
  return {
    db: drizzle(pool, { schema, mode: 'default' }) as RuntimeDatabase,
    pool,
  };
}
