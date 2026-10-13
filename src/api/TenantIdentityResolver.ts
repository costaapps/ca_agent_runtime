import { normalizeCompanyUUID } from '../tenancy/TenantDescriptor.js';

export interface ResolvedTenantIdentity {
  readonly CompanyUUID: string;
  readonly IdCompany: number;
}

/** Replaceable boundary between HTTP claims and the tenant identity trusted by routing. */
export interface TenantIdentityResolver {
  resolve(companyUUID: unknown, claimedIdCompany: number): ResolvedTenantIdentity | Promise<ResolvedTenantIdentity>;
}

/** Initial policy: use the CompanyUUID and IdCompany supplied by the Core request. */
export class RequestTenantIdentityResolver implements TenantIdentityResolver {
  resolve(companyUUID: unknown, claimedIdCompany: number): ResolvedTenantIdentity {
    return { CompanyUUID: normalizeCompanyUUID(companyUUID), IdCompany: claimedIdCompany };
  }
}
