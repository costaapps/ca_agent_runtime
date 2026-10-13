import { TenantRequestError } from './TenantRuntimeGateway.js';
import { TenantError, TenantErrorCodes } from '../tenancy/TenantError.js';

export interface TenantHttpError {
  statusCode: number;
  code: string;
  message: string;
}

export function getTenantHttpError(error: unknown): TenantHttpError | undefined {
  if (error instanceof TenantRequestError) {
    return { statusCode: error.statusCode, code: error.code, message: error.message };
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
