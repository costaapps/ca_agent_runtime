import { TenantError, TenantErrorCodes } from './TenantError.js';

export interface TenantDatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

/** Connection details are internal routing data and must never be serialized into diagnostics. */
export interface TenantDescriptor {
  readonly CompanyUUID: string;
  readonly IdDatabase: number;
  readonly IdCompany: number;
  readonly database: TenantDatabaseConfig;
}

const COMPANY_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeCompanyUUID(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TenantError(TenantErrorCodes.InvalidCompanyUUID, 'CompanyUUID deve ser um UUID válido.');
  }
  const normalized = value.trim().toLowerCase();
  if (!COMPANY_UUID_PATTERN.test(normalized)) {
    throw new TenantError(TenantErrorCodes.InvalidCompanyUUID, 'CompanyUUID deve ser um UUID válido.');
  }
  return normalized;
}

export function createTenantDescriptor(input: TenantDescriptor): TenantDescriptor {
  const descriptor = {} as TenantDescriptor;
  Object.defineProperties(descriptor, {
    CompanyUUID: {
      value: normalizeCompanyUUID(input.CompanyUUID),
      enumerable: true,
    },
    IdDatabase: {
      value: positiveInteger(input.IdDatabase, 'IdDatabase'),
      enumerable: true,
    },
    IdCompany: {
      value: positiveInteger(input.IdCompany, 'IdCompany'),
      enumerable: true,
    },
    // Keep credentials available to trusted runtime code while preventing an
    // accidental JSON.stringify(descriptor) from copying them into logs/traces.
    database: {
      value: Object.freeze({
        host: requiredString(input.database.host, 'host'),
        port: portNumber(input.database.port),
        database: requiredString(input.database.database, 'database'),
        user: requiredString(input.database.user, 'user'),
        // MariaDB permits an empty password in local/test installations, but the
        // registry field itself must still be present and a string.
        password: passwordString(input.database.password),
      }),
      enumerable: false,
    },
  });
  return Object.freeze(descriptor);
}

function positiveInteger(value: unknown, field: string): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0) {
    throw new TenantError(TenantErrorCodes.RegistryInconsistent, `Cadastro central inconsistente: ${field}.`);
  }
  return numberValue;
}

function portNumber(value: unknown): number {
  const port = positiveInteger(value, 'Port');
  if (port > 65535) {
    throw new TenantError(TenantErrorCodes.RegistryInconsistent, 'Cadastro central inconsistente: Port.');
  }
  return port;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TenantError(TenantErrorCodes.RegistryInconsistent, `Cadastro central inconsistente: ${field}.`);
  }
  return value.trim();
}

function passwordString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TenantError(TenantErrorCodes.RegistryInconsistent, 'Cadastro central inconsistente: Password.');
  }
  return value;
}
