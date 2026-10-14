import 'dotenv/config';
import mysql, { type Pool, type PoolOptions } from 'mysql2/promise';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as schema from './schema/index.js';
import { createCentralRegistry, type CentralRegistry, type CentralRegistryConfig } from '../tenancy/CentralRegistry.js';
import { normalizeCompanyUUID, type TenantDescriptor } from '../tenancy/TenantDescriptor.js';

const MIGRATIONS_FOLDER = './drizzle';

export interface TenantMigrationArguments {
  companyUUID: string;
}

export interface TenantMigrationConfig {
  centralRegistry: CentralRegistryConfig;
  migrationDatabase: {
    user: string;
    password: string;
  };
}

export interface ClosablePool {
  end(): Promise<void>;
}

export interface TenantMigrationDependencies {
  createRegistry(config: CentralRegistryConfig): Pick<CentralRegistry, 'resolve' | 'close'>;
  createPool(options: PoolOptions): ClosablePool;
  createDatabase(pool: ClosablePool): unknown;
  applyMigrations(database: unknown, config: { migrationsFolder: string }): Promise<void>;
}

/** Accepts only the documented `--company-uuid <UUID>` argument pair. */
export function parseTenantMigrationArguments(argv: readonly string[]): TenantMigrationArguments {
  if (argv.length !== 2 || argv[0] !== '--company-uuid') {
    throw new Error('Uso: db:migrate:prod -- --company-uuid <UUID>');
  }

  try {
    return { companyUUID: normalizeCompanyUUID(argv[1]) };
  } catch {
    throw new Error('O argumento --company-uuid deve conter um UUID válido.');
  }
}

/** Reads only the configuration required for one administrative tenant migration. */
export function parseTenantMigrationConfig(source: NodeJS.ProcessEnv): TenantMigrationConfig {
  return {
    centralRegistry: {
      host: requiredValue(source, 'CENTRAL_DB_HOST'),
      port: parsePort(source.CENTRAL_DB_PORT, 'CENTRAL_DB_PORT', 3306),
      database: requiredValue(source, 'CENTRAL_DB_NAME'),
      user: requiredValue(source, 'CENTRAL_DB_USER'),
      password: requiredPresentValue(source, 'CENTRAL_DB_PASS'),
      connectionLimit: parsePositiveInteger(source.CENTRAL_DB_CONNECTION_LIMIT, 'CENTRAL_DB_CONNECTION_LIMIT', 4),
      cacheTtlMs: parsePositiveInteger(source.CENTRAL_REGISTRY_CACHE_MS, 'CENTRAL_REGISTRY_CACHE_MS', 60_000),
    },
    migrationDatabase: {
      user: requiredValue(source, 'MIGRATION_DB_USER'),
      password: requiredPresentValue(source, 'MIGRATION_DB_PASSWORD'),
    },
  };
}

/** Resolves exactly one tenant, migrates its database with administrative credentials, and closes both pools. */
export async function migrateTenantDatabase(
  companyUUID: string,
  config: TenantMigrationConfig,
  dependencies: TenantMigrationDependencies = defaultDependencies,
): Promise<TenantDescriptor> {
  const registry = dependencies.createRegistry(config.centralRegistry);
  let tenantPool: ClosablePool | undefined;
  let migrationSucceeded = false;
  let descriptor: TenantDescriptor | undefined;

  try {
    descriptor = await registry.resolve(companyUUID);
    tenantPool = dependencies.createPool({
      host: descriptor.database.host,
      port: descriptor.database.port,
      database: descriptor.database.database,
      user: config.migrationDatabase.user,
      password: config.migrationDatabase.password,
      connectionLimit: 1,
      waitForConnections: true,
      namedPlaceholders: true,
    });
    const database = dependencies.createDatabase(tenantPool);
    await dependencies.applyMigrations(database, { migrationsFolder: MIGRATIONS_FOLDER });
    migrationSucceeded = true;
  } finally {
    let cleanupFailed = false;
    if (tenantPool) {
      try {
        await tenantPool.end();
      } catch {
        cleanupFailed = true;
      }
    }
    try {
      await registry.close();
    } catch {
      cleanupFailed = true;
    }
    if (migrationSucceeded && cleanupFailed) {
      throw new Error('Não foi possível encerrar todas as conexões da migration.');
    }
  }

  return descriptor!;
}

function requiredValue(source: NodeJS.ProcessEnv, name: string): string {
  const value = requiredPresentValue(source, name).trim();
  if (value.length === 0) throw new Error(`A variável ${name} é obrigatória.`);
  return value;
}

function requiredPresentValue(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name];
  if (value === undefined) throw new Error(`A variável ${name} é obrigatória.`);
  return value;
}

function parsePort(value: string | undefined, name: string, fallback: number): number {
  const port = parsePositiveInteger(value, name, fallback);
  if (port > 65_535) throw new Error(`A variável ${name} deve ser uma porta válida.`);
  return port;
}

function parsePositiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`A variável ${name} deve ser um inteiro positivo.`);
  }
  return parsed;
}

const defaultDependencies: TenantMigrationDependencies = {
  createRegistry: createCentralRegistry,
  createPool: (options) => mysql.createPool(options),
  createDatabase: (pool) => drizzle(pool as Pool, { schema, mode: 'default' }),
  applyMigrations: (database, config) => migrate(database as MySql2Database<typeof schema>, config),
};

async function main(): Promise<void> {
  try {
    const { companyUUID } = parseTenantMigrationArguments(process.argv.slice(2));
    const config = parseTenantMigrationConfig(process.env);
    await migrateTenantDatabase(companyUUID, config);
    console.log(`Migrations aplicadas para CompanyUUID ${companyUUID}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao executar migration.';
    console.error(message);
    process.exitCode = 1;
  }
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isEntryPoint()) await main();
