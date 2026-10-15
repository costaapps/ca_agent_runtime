import { TenantRequestError } from './TenantRuntimeGateway.js';
import { TenantError, TenantErrorCodes } from '../tenancy/TenantError.js';
import { ErrorCodes } from '../errors/errorCodes.js';
import { isDatabaseConnectivityError, isDatabaseOperationError, RuntimeError, SAFE_PERSISTENCE_ERROR_MESSAGE, SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE } from '../errors/RuntimeError.js';

export interface TenantHttpError {
  statusCode: number;
  code: string;
  message: string;
}

export function getTenantHttpError(error: unknown): TenantHttpError | undefined {
  if (error instanceof TenantRequestError) {
    return { statusCode: error.statusCode, code: error.code, message: error.message };
  }
  if (isDatabaseConnectivityError(error)) {
    return { statusCode: 503, code: TenantErrorCodes.DatabaseUnavailable, message: SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE };
  }
  if (!(error instanceof TenantError)) return undefined;

  switch (error.code) {
    case TenantErrorCodes.InvalidCompanyUUID:
      return { statusCode: 400, code: error.code, message: error.message };
    case TenantErrorCodes.NotFound:
      return { statusCode: 404, code: error.code, message: error.message };
    case TenantErrorCodes.RegistryInconsistent:
      return { statusCode: 409, code: error.code, message: error.message };
    case TenantErrorCodes.RegistryUnavailable:
    case TenantErrorCodes.DatabaseUnavailable:
    case TenantErrorCodes.PoolCapacity:
    case TenantErrorCodes.ManagerClosed:
      return { statusCode: 503, code: error.code, message: error.message };
  }
}

/** Maps runtime/database failures without ever returning driver SQL or parameters. */
export function getRuntimeHttpError(error: unknown): TenantHttpError | undefined {
  const tenantError = getTenantHttpError(error);
  if (tenantError) return tenantError;

  if (error instanceof RuntimeError) {
    if (error.code === ErrorCodes.TenantDatabaseUnavailable || error.code === ErrorCodes.TenantPoolUnavailable || error.code === ErrorCodes.TenantRegistryUnavailable) {
      return { statusCode: 503, code: error.code, message: SAFE_TENANT_DATABASE_UNAVAILABLE_MESSAGE };
    }
    if (error.code === ErrorCodes.PersistenceError) {
      return { statusCode: 500, code: ErrorCodes.PersistenceError, message: SAFE_PERSISTENCE_ERROR_MESSAGE };
    }
  }
  if (isDatabaseOperationError(error)) {
    return { statusCode: 500, code: ErrorCodes.PersistenceError, message: SAFE_PERSISTENCE_ERROR_MESSAGE };
  }
}
