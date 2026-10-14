import { describe, expect, it, vi } from 'vitest';
import { migrateTenantDatabase, parseTenantMigrationArguments, parseTenantMigrationConfig, type TenantMigrationDependencies } from '../../src/database/migrate.js';
import { createTenantDescriptor } from '../../src/tenancy/TenantDescriptor.js';

const COMPANY_UUID = 'd2719f62-8a67-4fd5-a6ae-411a6a3ef177';

const minimalEnvironment: NodeJS.ProcessEnv = {
  CENTRAL_DB_HOST: 'registry.internal',
  CENTRAL_DB_NAME: 'central',
  CENTRAL_DB_USER: 'registry-reader',
  CENTRAL_DB_PASS: 'registry-secret',
  MIGRATION_DB_USER: 'schema-admin',
  MIGRATION_DB_PASSWORD: 'admin-secret',
};

describe('tenant administrative migration command', () => {
  it('accepts exactly --company-uuid followed by a valid UUID', () => {
    expect(parseTenantMigrationArguments(['--company-uuid', ` ${COMPANY_UUID.toUpperCase()} `])).toEqual({
      companyUUID: COMPANY_UUID,
    });
    expect(() => parseTenantMigrationArguments([])).toThrow(/Uso:/);
    expect(() => parseTenantMigrationArguments(['--company-uuid'])).toThrow(/Uso:/);
    expect(() => parseTenantMigrationArguments(['--company-uuid', COMPANY_UUID, '--extra'])).toThrow(/Uso:/);
    expect(() => parseTenantMigrationArguments([`--company-uuid=${COMPANY_UUID}`])).toThrow(/Uso:/);
    expect(() => parseTenantMigrationArguments(['--company-uuid', 'not-a-uuid'])).toThrow(/UUID válido/);
  });

  it('validates only central registry and migration credentials, applying documented defaults', () => {
    expect(parseTenantMigrationConfig(minimalEnvironment)).toEqual({
      centralRegistry: {
        host: 'registry.internal',
        port: 3306,
        database: 'central',
        user: 'registry-reader',
        password: 'registry-secret',
        connectionLimit: 4,
        cacheTtlMs: 60_000,
      },
      migrationDatabase: { user: 'schema-admin', password: 'admin-secret' },
    });

    expect(() => parseTenantMigrationConfig({ ...minimalEnvironment, CENTRAL_DB_PORT: '70000' })).toThrow(/porta válida/);
    expect(() => parseTenantMigrationConfig({ ...minimalEnvironment, CENTRAL_DB_PASS: undefined })).toThrow(/CENTRAL_DB_PASS/);
    expect(() => parseTenantMigrationConfig({ ...minimalEnvironment, MIGRATION_DB_PASSWORD: undefined })).toThrow(/MIGRATION_DB_PASSWORD/);
    expect(() => parseTenantMigrationConfig({ ...minimalEnvironment, CENTRAL_REGISTRY_CACHE_MS: '0' })).toThrow(/inteiro positivo/);
  });

  it('resolves one descriptor, uses its route with admin credentials, and closes both pools', async () => {
    const descriptor = createTenantDescriptor({
      CompanyUUID: COMPANY_UUID,
      IdDatabase: 81,
      IdCompany: 120,
      database: {
        host: 'tenant-db.internal',
        port: 3307,
        database: 'tenant_120',
        user: 'runtime-user',
        password: 'runtime-secret',
      },
    });
    const registry = {
      resolve: vi.fn().mockResolvedValue(descriptor),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const tenantPool = { end: vi.fn().mockResolvedValue(undefined) };
    const database = { handle: 'tenant-db' };
    const dependencies: TenantMigrationDependencies = {
      createRegistry: vi.fn().mockReturnValue(registry),
      createPool: vi.fn().mockReturnValue(tenantPool),
      createDatabase: vi.fn().mockReturnValue(database),
      applyMigrations: vi.fn().mockResolvedValue(undefined),
    };

    await expect(migrateTenantDatabase(COMPANY_UUID, parseTenantMigrationConfig(minimalEnvironment), dependencies)).resolves.toBe(descriptor);

    expect(dependencies.createRegistry).toHaveBeenCalledWith({
      host: 'registry.internal',
      port: 3306,
      database: 'central',
      user: 'registry-reader',
      password: 'registry-secret',
      connectionLimit: 4,
      cacheTtlMs: 60_000,
    });
    expect(registry.resolve).toHaveBeenCalledExactlyOnceWith(COMPANY_UUID);
    expect(dependencies.createPool).toHaveBeenCalledExactlyOnceWith({
      host: 'tenant-db.internal',
      port: 3307,
      database: 'tenant_120',
      user: 'schema-admin',
      password: 'admin-secret',
      connectionLimit: 1,
      waitForConnections: true,
      namedPlaceholders: true,
    });
    expect(dependencies.createDatabase).toHaveBeenCalledExactlyOnceWith(tenantPool);
    expect(dependencies.applyMigrations).toHaveBeenCalledExactlyOnceWith(database, { migrationsFolder: './drizzle' });
    expect(tenantPool.end).toHaveBeenCalledOnce();
    expect(registry.close).toHaveBeenCalledOnce();
  });

  it('closes the tenant and Registry pools when the migration fails', async () => {
    const descriptor = createTenantDescriptor({
      CompanyUUID: COMPANY_UUID,
      IdDatabase: 81,
      IdCompany: 120,
      database: { host: 'tenant-db.internal', port: 3306, database: 'tenant_120', user: 'runtime', password: '' },
    });
    const registry = { resolve: vi.fn().mockResolvedValue(descriptor), close: vi.fn().mockResolvedValue(undefined) };
    const tenantPool = { end: vi.fn().mockResolvedValue(undefined) };
    const migrationFailure = new Error('migration failed');
    const dependencies: TenantMigrationDependencies = {
      createRegistry: () => registry,
      createPool: () => tenantPool,
      createDatabase: () => ({}),
      applyMigrations: vi.fn().mockRejectedValue(migrationFailure),
    };

    await expect(migrateTenantDatabase(COMPANY_UUID, parseTenantMigrationConfig(minimalEnvironment), dependencies)).rejects.toBe(migrationFailure);
    expect(tenantPool.end).toHaveBeenCalledOnce();
    expect(registry.close).toHaveBeenCalledOnce();
  });
});
