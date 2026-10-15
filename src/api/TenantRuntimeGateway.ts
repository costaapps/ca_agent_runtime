import type { AgentRunInput } from './contracts/agentRunInput.js';
import type { AgentRuntimeRunResult, AgentTurnRuntimeResult, AgentSessionCloseRuntimeResult } from '../runtime/AgentRuntime.js';
import type { AgentTurnInput } from './contracts/agentTurnInput.js';
import type { AgentSessionCloseInput } from './contracts/agentSessionClose.js';
import type { FlowAssistInput } from './contracts/flowAssistInput.js';
import type { FlowAssistRuntimeResult } from '../runtime/FlowAssistRuntime.js';
import type { AgentRuntime } from '../runtime/AgentRuntime.js';
import type { CentralRegistry } from '../tenancy/CentralRegistry.js';
import { normalizeCompanyUUID, type TenantDescriptor } from '../tenancy/TenantDescriptor.js';
import { TenantError, TenantErrorCodes } from '../tenancy/TenantError.js';
import { TenantConnectionManager } from '../tenancy/ConnectionManager.js';
import type { RuntimeDatabase } from '../database/connection.js';
import { RequestTenantIdentityResolver, type TenantIdentityResolver } from './TenantIdentityResolver.js';

export interface TenantRuntimeGatewayOptions {
  readonly allowlist: readonly string[];
  readonly registry: CentralRegistry;
  readonly connections: TenantConnectionManager;
  readonly identityResolver?: TenantIdentityResolver;
  readonly buildRuntime: (tenant: TenantDescriptor, database: RuntimeDatabase) => AgentRuntime;
}

/** Resolves a tenant and pins its connection generation for the complete HTTP operation. */
export class TenantRuntimeGateway {
  private readonly allowlist: ReadonlySet<string>;
  private readonly identityResolver: TenantIdentityResolver;
  private accepting = true;
  private activeRequests = 0;
  private readonly drainWaiters = new Set<() => void>();

  constructor(private readonly options: TenantRuntimeGatewayOptions) {
    this.allowlist = new Set(options.allowlist.map(normalizeCompanyUUID));
    this.identityResolver = options.identityResolver ?? new RequestTenantIdentityResolver();
  }

  run(input: AgentRunInput): Promise<AgentRuntimeRunResult> {
    return this.withRuntime(input.CompanyUUID, input.IdCompany, (runtime) => runtime.run(input));
  }

  runTurn(input: AgentTurnInput): Promise<AgentTurnRuntimeResult> {
    return this.withRuntime(input.CompanyUUID, input.IdCompany, (runtime) => runtime.runTurn(input));
  }

  closeSession(input: AgentSessionCloseInput): Promise<AgentSessionCloseRuntimeResult> {
    return this.withRuntime(input.CompanyUUID, input.IdCompany, (runtime) => runtime.closeSession(input));
  }

  runFlowAssist(input: FlowAssistInput): Promise<FlowAssistRuntimeResult> {
    return this.withRuntime(input.CompanyUUID, input.IdCompany, (runtime) => runtime.runFlowAssist(input));
  }

  stopAccepting(): void {
    this.accepting = false;
    this.notifyDrained();
  }

  getActiveRequestCount(): number {
    return this.activeRequests;
  }

  waitForDrain(timeoutMs: number): Promise<boolean> {
    if (this.activeRequests === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (drained: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.drainWaiters.delete(onDrained);
        resolve(drained);
      };
      const onDrained = (): void => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      timer.unref?.();
      this.drainWaiters.add(onDrained);
    });
  }

  private async withRuntime<T>(companyUUID: unknown, idCompany: number, operation: (runtime: AgentRuntime) => Promise<T>): Promise<T> {
    if (!this.accepting) throw new TenantError(TenantErrorCodes.ManagerClosed, 'Agent Runtime está encerrando.');
    this.activeRequests += 1;
    let lease: Awaited<ReturnType<TenantConnectionManager['acquire']>> | undefined;
    try {
      const identity = await this.identityResolver.resolve(companyUUID, idCompany);
      if (!this.allowlist.has(identity.CompanyUUID)) {
        throw new TenantRequestError(403, 'TENANT_NOT_ALLOWED', 'Empresa não habilitada neste Agent Runtime.');
      }

      const descriptor = await this.options.registry.resolve(identity.CompanyUUID);
      if (descriptor.IdCompany !== identity.IdCompany) {
        throw new TenantError(TenantErrorCodes.RegistryInconsistent, 'IdCompany não corresponde ao cadastro da empresa.');
      }

      lease = await this.options.connections.acquire(descriptor);
      const runtime = this.options.buildRuntime(descriptor, lease.db);
      return await operation(runtime);
    } finally {
      try {
        await lease?.release();
      } catch {
        // Cleanup failures must not replace a completed response or the original
        // operation error. Keep diagnostics limited to non-secret tenant IDs.
        console.error(JSON.stringify({
          Event: 'TENANT_POOL_RELEASE_FAILED',
          CompanyUUID: lease?.descriptor.CompanyUUID,
          IdDatabase: lease?.descriptor.IdDatabase,
        }));
      } finally {
        this.activeRequests -= 1;
        this.notifyDrained();
      }
    }
  }

  private notifyDrained(): void {
    if (this.activeRequests !== 0) return;
    for (const resolve of this.drainWaiters) resolve();
    this.drainWaiters.clear();
  }
}

export class TenantRequestError extends Error {
  constructor(readonly statusCode: 400 | 403, readonly code: string, message: string) {
    super(message);
    this.name = 'TenantRequestError';
  }
}
