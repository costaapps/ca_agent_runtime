import { createHash } from 'node:crypto';
import mysql, { type Pool } from 'mysql2/promise';
import { createTenantDescriptor, normalizeCompanyUUID, type TenantDescriptor } from './TenantDescriptor.js';
import { TenantError, TenantErrorCodes } from './TenantError.js';

const COMPANY_LOOKUP_SQL = `
  SELECT
    c.CompanyUUID AS CompanyUUID,
    c.IdDatabase AS IdDatabase,
    c.IdCompany AS IdCompany,
    (
      SELECT COUNT(*)
      FROM Company AS duplicate_company
      WHERE duplicate_company.IdDatabase = c.IdDatabase
        AND duplicate_company.IdCompany = c.IdCompany
    ) AS CompanyIdentityCount,
    d.Hostname AS Hostname,
    d.Port AS Port,
    d.DBName AS DBName,
    d.Username AS Username,
    d.Password AS Password
  FROM Company AS c
  LEFT JOIN \`Databases\` AS d ON d.IdDatabase = c.IdDatabase
  WHERE c.CompanyUUID = ?
  LIMIT 2
`;

export interface CentralRegistryConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly connectionLimit?: number;
  readonly cacheTtlMs?: number;
}

export type RegistryQuery = (sql: string, values?: readonly unknown[]) => Promise<unknown>;

export interface CentralRegistryOptions {
  readonly query: RegistryQuery;
  readonly close?: () => Promise<void>;
  readonly cacheTtlMs?: number;
  readonly now?: () => number;
}

interface CacheEntry {
  readonly descriptor: TenantDescriptor;
  readonly expiresAt: number;
}

interface DatabaseConfigState {
  readonly fingerprint: string;
  readonly lookupSequence: number;
}

/** Reads only the central Company/Databases registry and caches descriptors by CompanyUUID. */
export class CentralRegistry {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<TenantDescriptor>>();
  private readonly databaseConfigs = new Map<number, DatabaseConfigState>();
  private lookupSequence = 0;
  private readonly now: () => number;
  private readonly cacheTtlMs: number;

  constructor(private readonly options: CentralRegistryOptions) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.now = options.now ?? Date.now;
    if (!Number.isFinite(this.cacheTtlMs) || this.cacheTtlMs < 0) {
      throw new TypeError('cacheTtlMs deve ser um número não negativo.');
    }
  }

  async resolve(companyUUID: unknown): Promise<TenantDescriptor> {
    const normalized = normalizeCompanyUUID(companyUUID);
    const cached = this.cache.get(normalized);
    if (cached && cached.expiresAt > this.now()) return cached.descriptor;

    const existing = this.inflight.get(normalized);
    if (existing) return existing;

    const lookupSequence = ++this.lookupSequence;
    const request = this.load(normalized, lookupSequence)
      .then((descriptor) => {
        const current = this.databaseConfigs.get(descriptor.IdDatabase);
        if (current?.fingerprint === connectionFingerprint(descriptor)) {
          this.cache.set(normalized, { descriptor, expiresAt: this.now() + this.cacheTtlMs });
        }
        return descriptor;
      })
      .finally(() => {
        if (this.inflight.get(normalized) === request) this.inflight.delete(normalized);
      });
    this.inflight.set(normalized, request);
    return request;
  }

  /** Readiness probe for the central Registry. It does not enumerate tenant databases. */
  async checkAvailable(): Promise<void> {
    try {
      await this.options.query('SELECT 1');
    } catch {
      throw new TenantError(TenantErrorCodes.RegistryUnavailable, 'Registry central indisponível.');
    }
  }

  async close(): Promise<void> {
    await this.options.close?.();
  }

  private async load(companyUUID: string, lookupSequence: number): Promise<TenantDescriptor> {
    let raw: unknown;
    try {
      raw = await this.options.query(COMPANY_LOOKUP_SQL, [companyUUID]);
    } catch {
      throw new TenantError(TenantErrorCodes.RegistryUnavailable, 'Registry central indisponível.');
    }

    const rows = unwrapRows(raw);
    if (rows.length === 0) {
      throw new TenantError(TenantErrorCodes.NotFound, 'Empresa não encontrada no Registry central.');
    }
    if (rows.length !== 1) {
      throw new TenantError(TenantErrorCodes.RegistryInconsistent, 'Cadastro central inconsistente para a empresa.');
    }

    const row = rows[0];
    if (!row || typeof row !== 'object') {
      throw new TenantError(TenantErrorCodes.RegistryInconsistent, 'Cadastro central inconsistente para a empresa.');
    }

    const record = row as Record<string, unknown>;
    let rowUUID: string;
    try {
      rowUUID = normalizeCompanyUUID(record.CompanyUUID);
    } catch {
      throw new TenantError(TenantErrorCodes.RegistryInconsistent, 'Cadastro central inconsistente para a empresa.');
    }
    if (rowUUID !== companyUUID) {
      throw new TenantError(TenantErrorCodes.RegistryInconsistent, 'Cadastro central inconsistente para a empresa.');
    }
    if (Number(record.CompanyIdentityCount) !== 1) {
      throw new TenantError(TenantErrorCodes.RegistryInconsistent, 'Cadastro central inconsistente para a empresa.');
    }

    const descriptor = createTenantDescriptor({
      CompanyUUID: rowUUID,
      IdDatabase: record.IdDatabase as number,
      IdCompany: record.IdCompany as number,
      database: {
        host: record.Hostname as string,
        port: record.Port as number,
        database: record.DBName as string,
        user: record.Username as string,
        password: record.Password as string,
      },
    });
    this.rememberDatabaseConfig(descriptor, lookupSequence);
    return descriptor;
  }

  private rememberDatabaseConfig(descriptor: TenantDescriptor, lookupSequence: number): void {
    const fingerprint = connectionFingerprint(descriptor);
    const current = this.databaseConfigs.get(descriptor.IdDatabase);
    if (current && lookupSequence < current.lookupSequence && fingerprint !== current.fingerprint) {
      // An older in-flight lookup finished after a newer one. Return its frozen
      // descriptor to that request, but do not let it replace newer cached config.
      return;
    }

    if (current && fingerprint !== current.fingerprint) {
      // Databases rows are shared by every company that references IdDatabase.
      // A refresh for one company must invalidate sibling descriptors too.
      for (const [uuid, entry] of this.cache) {
        if (entry.descriptor.IdDatabase === descriptor.IdDatabase) this.cache.delete(uuid);
      }
    }
    if (!current || lookupSequence >= current.lookupSequence || fingerprint !== current.fingerprint) {
      this.databaseConfigs.set(descriptor.IdDatabase, { fingerprint, lookupSequence });
    }
  }
}

function connectionFingerprint(descriptor: TenantDescriptor): string {
  const config = descriptor.database;
  const canonical = JSON.stringify([config.host, config.port, config.database, config.user, config.password]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Creates a production Registry reader with a small, bounded pool. */
export function createCentralRegistry(config: CentralRegistryConfig): CentralRegistry {
  const pool: Pool = mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionLimit: config.connectionLimit ?? 4,
    waitForConnections: true,
    namedPlaceholders: true,
  });

  return new CentralRegistry({
    cacheTtlMs: config.cacheTtlMs ?? 60_000,
    query: async (sql, values) => {
      const [rows] = await pool.execute(sql, values ? [...values] as never[] : []);
      return rows;
    },
    close: () => pool.end(),
  });
}

function unwrapRows(raw: unknown): Record<string, unknown>[] {
  // mysql2 execute returns [rows, fields], while injected adapters can return rows directly.
  const candidate = Array.isArray(raw) && raw.length === 2 && Array.isArray(raw[0]) ? raw[0] : raw;
  if (!Array.isArray(candidate)) {
    throw new TenantError(TenantErrorCodes.RegistryInconsistent, 'Resposta inválida do Registry central.');
  }
  return candidate as Record<string, unknown>[];
}
