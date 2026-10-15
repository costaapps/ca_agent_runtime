export const TenantErrorCodes = {
  InvalidCompanyUUID: 'TENANT_UUID_INVALID',
  NotFound: 'TENANT_NOT_FOUND',
  RegistryInconsistent: 'TENANT_REGISTRY_INCONSISTENT',
  RegistryUnavailable: 'TENANT_REGISTRY_UNAVAILABLE',
  DatabaseUnavailable: 'TENANT_DATABASE_UNAVAILABLE',
  PoolCapacity: 'TENANT_POOL_CAPACITY',
  ManagerClosed: 'TENANT_POOL_MANAGER_CLOSED',
} as const;

export type TenantErrorCode = typeof TenantErrorCodes[keyof typeof TenantErrorCodes];

/** An operational error whose message is safe to return or log without connection details. */
export class TenantError extends Error {
  readonly code: TenantErrorCode;

  constructor(code: TenantErrorCode, message: string) {
    super(message);
    this.name = 'TenantError';
    this.code = code;
  }
}
