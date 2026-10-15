import { ErrorCodes, type ErrorCode } from './errorCodes.js';

export const SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE = 'Base da empresa temporariamente indisponível.';
export const SAFE_PERSISTENCE_ERROR_MESSAGE = 'Não foi possível persistir os dados da execução.';

const genericNetworkErrorCodes = new Set([
  'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTDOWN', 'EHOSTUNREACH', 'EPIPE', 'ENETUNREACH',
  'ENOTFOUND', 'ETIMEDOUT',
]);

const databaseConnectionErrorCodes = new Set([
  'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_SEQUENCE_TIMEOUT', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT', 'ER_ABORTING_CONNECTION', 'ER_CON_COUNT_ERROR', 'ER_HOST_IS_BLOCKED',
  'ER_HOST_NOT_PRIVILEGED', 'ER_SERVER_SHUTDOWN', 'ER_SERVER_GONE_ERROR', 'ER_SERVER_LOST',
  'ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_NET_READ_ERROR', 'ER_NET_WRITE_ERROR',
  'ER_NET_READ_INTERRUPTED', 'ER_NET_WRITE_INTERRUPTED', 'ER_NET_READ_ERROR_FROM_PIPE',
]);

const connectionErrorNumbers = new Set([1040, 1044, 1045, 1053, 1129, 1130, 1152, 1154, 1155, 1156, 1157, 1158, 1159, 1160, 1161, 2002, 2003, 2005, 2006, 2013, 2055]);

// Explicitly keep schema, integrity, and data errors out of the availability class,
// even if an outer driver wrapper happens to carry a generic network-like field.
const nonAvailabilityErrorCodes = new Set([
  'ER_DUP_ENTRY', 'ER_BAD_NULL_ERROR', 'ER_NO_REFERENCED_ROW_2', 'ER_ROW_IS_REFERENCED_2',
  'ER_CHECK_CONSTRAINT_VIOLATED', 'ER_DATA_TOO_LONG', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR',
  'ER_PARSE_ERROR', 'ER_TRUNCATED_WRONG_VALUE', 'ER_WRONG_VALUE_COUNT_ON_ROW',
]);

export class RuntimeError extends Error {
  readonly code: ErrorCode | string;
  readonly causeError?: unknown;

  constructor(code: ErrorCode | string, message: string, causeError?: unknown) {
    super(message, causeError === undefined ? undefined : { cause: causeError });
    this.name = 'RuntimeError';
    this.code = code;
    this.causeError = causeError;
  }
}

export class AgentNotFoundError extends RuntimeError {
  constructor(agent: string) {
    super(ErrorCodes.AgentNotFound, `Agent '${agent}' não encontrado.`);
    this.name = 'AgentNotFoundError';
  }
}

export function asRuntimeError(error: unknown, fallbackCode: ErrorCode | string = ErrorCodes.AgentRuntimeError): RuntimeError {
  if (isDatabaseConnectivityError(error)) {
    return new RuntimeError(ErrorCodes.TenantDatabaseUnavailable, SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE, error);
  }
  if (isDatabaseOperationError(error)) {
    return new RuntimeError(ErrorCodes.PersistenceError, SAFE_PERSISTENCE_ERROR_MESSAGE, error);
  }
  if (error instanceof RuntimeError) {
    if (error.code === ErrorCodes.PersistenceError) {
      return new RuntimeError(error.code, SAFE_PERSISTENCE_ERROR_MESSAGE, error.causeError ?? error);
    }
    if (error.code === ErrorCodes.TenantDatabaseUnavailable) {
      return new RuntimeError(error.code, SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE, error.causeError ?? error);
    }
    return error;
  }
  if (error instanceof Error) {
    const message = fallbackCode === ErrorCodes.PersistenceError ? SAFE_PERSISTENCE_ERROR_MESSAGE : error.message;
    return new RuntimeError(fallbackCode, message, error);
  }
  return new RuntimeError(fallbackCode, 'Erro inesperado durante a execução.', error);
}

/**
 * Converts an error caught at a known database/repository/logger boundary.
 * Generic socket codes count as database unavailability here because the caller
 * establishes the operation's origin; inference and provider catches must use
 * asRuntimeError instead.
 */
export function asDatabaseRuntimeError(error: unknown): RuntimeError {
  if (isDatabaseConnectivityError(error) || isGenericNetworkConnectionError(error)) {
    return new RuntimeError(ErrorCodes.TenantDatabaseUnavailable, SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE, error);
  }
  if (error instanceof RuntimeError && error.code === ErrorCodes.TenantDatabaseUnavailable) {
    return new RuntimeError(error.code, SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE, error.causeError ?? error);
  }
  return new RuntimeError(ErrorCodes.PersistenceError, SAFE_PERSISTENCE_ERROR_MESSAGE, error);
}

/**
 * Recognizes connection failures across mysql2 and Drizzle wrappers. Only known
 * network/connection codes and SQLSTATE connection/authentication classes match;
 * integrity and schema errors are deliberately excluded.
 */
export function isDatabaseConnectivityError(error: unknown): boolean {
  const pending: unknown[] = [error];
  const visited = new Set<object>();
  let sawNonAvailabilityCode = false;
  let sawDatabaseConnectivityCode = false;
  let sawGenericNetworkCode = false;
  let sawDatabaseErrorContext = false;

  while (pending.length > 0) {
    const current = pending.pop();
    if ((typeof current !== 'object' && typeof current !== 'function') || current === null) continue;
    const object = current as Record<string, unknown>;
    if (visited.has(object)) continue;
    visited.add(object);

    const code = readStringProperty(object, 'code')?.toUpperCase();
    if (code && nonAvailabilityErrorCodes.has(code)) sawNonAvailabilityCode = true;
    if (code && databaseConnectionErrorCodes.has(code)) sawDatabaseConnectivityCode = true;
    if (code && genericNetworkErrorCodes.has(code)) sawGenericNetworkCode = true;

    const errno = readNumberProperty(object, 'errno');
    if (errno !== undefined && connectionErrorNumbers.has(errno)) sawDatabaseConnectivityCode = true;

    const sqlState = readStringProperty(object, 'sqlState')
      ?? readStringProperty(object, 'sqlstate')
      ?? readStringProperty(object, 'SQLSTATE');
    if (sqlState) {
      const sqlStateClass = sqlState.slice(0, 2).toUpperCase();
      if (sqlStateClass === '08' || sqlStateClass === '28') sawDatabaseConnectivityCode = true;
      if (sqlStateClass === '23' || sqlStateClass === '42') sawNonAvailabilityCode = true;
    }

    const name = readStringProperty(object, 'name');
    if (name === 'DrizzleError' || name === 'DrizzleQueryError' || readStringProperty(object, 'query') !== undefined) sawDatabaseErrorContext = true;
    if (readStringProperty(object, 'sql') !== undefined || readStringProperty(object, 'sqlMessage') !== undefined
      || readBooleanProperty(object, 'fatal') === true) sawDatabaseErrorContext = true;

    // Drizzle's driver errors and mysql2 errors have used different cause keys
    // across versions. Read only known wrapper links and tolerate hostile getters.
    for (const key of ['cause', 'causeError', 'originalError', 'driverError', 'parent', 'error']) {
      try {
        const nested = object[key];
        if (nested !== undefined && nested !== current) pending.push(nested);
      } catch {
        // A diagnostic getter must not affect classification or expose details.
      }
    }
  }

  return (sawDatabaseConnectivityCode || (sawGenericNetworkCode && sawDatabaseErrorContext)) && !sawNonAvailabilityCode;
}

function isGenericNetworkConnectionError(error: unknown): boolean {
  const pending: unknown[] = [error];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if ((typeof current !== 'object' && typeof current !== 'function') || current === null) continue;
    const object = current as Record<string, unknown>;
    if (visited.has(object)) continue;
    visited.add(object);
    const code = readStringProperty(object, 'code')?.toUpperCase();
    if (code && genericNetworkErrorCodes.has(code)) return true;
    for (const key of ['cause', 'causeError', 'originalError', 'driverError', 'parent', 'error']) {
      try {
        const nested = object[key];
        if (nested !== undefined && nested !== current) pending.push(nested);
      } catch {
        // Ignore diagnostic getters.
      }
    }
  }
  return false;
}

/** Identifies a database/driver error that must be reported as persistence failure. */
export function isDatabaseOperationError(error: unknown): boolean {
  const pending: unknown[] = [error];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if ((typeof current !== 'object' && typeof current !== 'function') || current === null) continue;
    const object = current as Record<string, unknown>;
    if (visited.has(object)) continue;
    visited.add(object);

    const code = readStringProperty(object, 'code')?.toUpperCase();
    const sqlState = readStringProperty(object, 'sqlState') ?? readStringProperty(object, 'sqlstate');
    const name = readStringProperty(object, 'name');
    if (code?.startsWith('ER_') || code?.startsWith('WARN_') || code?.startsWith('PROTOCOL_')
      || sqlState !== undefined || name === 'DrizzleError' || name === 'DrizzleQueryError'
      || readStringProperty(object, 'query') !== undefined) return true;

    for (const key of ['cause', 'causeError', 'originalError', 'driverError', 'parent', 'error']) {
      try {
        const nested = object[key];
        if (nested !== undefined && nested !== current) pending.push(nested);
      } catch {
        // Ignore diagnostic getters; classification must remain side-effect free.
      }
    }
  }
  return false;
}

function readStringProperty(object: Record<string, unknown>, key: string): string | undefined {
  try { return typeof object[key] === 'string' ? object[key] as string : undefined; } catch { return undefined; }
}

function readNumberProperty(object: Record<string, unknown>, key: string): number | undefined {
  try { return typeof object[key] === 'number' ? object[key] as number : undefined; } catch { return undefined; }
}

function readBooleanProperty(object: Record<string, unknown>, key: string): boolean | undefined {
  try { return typeof object[key] === 'boolean' ? object[key] as boolean : undefined; } catch { return undefined; }
}
