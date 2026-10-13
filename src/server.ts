import 'dotenv/config';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { DrizzleAiExecutionRepository } from './database/repositories/aiExecutionRepository.js';
import { DrizzleAgentSessionRepository } from './database/repositories/aiSessionRepository.js';
import { AgentRegistry } from './agents/AgentRegistry.js';
import { createOpenAIRunner } from './openai/runner.js';
import { createMcpClient } from './mcp/client.js';
import { McpObservabilityRegistry } from './mcp/observability.js';
import { AgentRuntime } from './runtime/AgentRuntime.js';
import { SessionMutex } from './runtime/SessionMutex.js';
import { createCentralRegistry } from './tenancy/CentralRegistry.js';
import { TenantConnectionManager } from './tenancy/ConnectionManager.js';
import type { TenantDescriptor } from './tenancy/TenantDescriptor.js';
import { TenantRuntimeGateway } from './api/TenantRuntimeGateway.js';
import type { RuntimeDatabase } from './database/connection.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const centralRegistry = createCentralRegistry({
    host: env.CENTRAL_DB_HOST,
    port: env.CENTRAL_DB_PORT,
    database: env.CENTRAL_DB_NAME,
    user: env.CENTRAL_DB_USER,
    password: env.CENTRAL_DB_PASS,
    connectionLimit: env.CENTRAL_DB_CONNECTION_LIMIT,
    cacheTtlMs: env.CENTRAL_REGISTRY_CACHE_MS,
  });
  const connections = new TenantConnectionManager({
    connectionLimit: env.TENANT_DB_CONNECTION_LIMIT,
    maxPools: env.TENANT_DB_MAX_POOLS,
    idleTimeoutMs: env.TENANT_DB_IDLE_TIMEOUT_MS,
  });
  const observability = new McpObservabilityRegistry();
  const mcp = createMcpClient(env, observability);
  const sharedSessionMutex = new SessionMutex();
  const activeTurns = new Map<string, string>();
  const runner = createOpenAIRunner();
  const buildRuntime = (tenant: TenantDescriptor, database: RuntimeDatabase) => new AgentRuntime({
    repository: new DrizzleAiExecutionRepository(database, tenant.IdCompany),
    sessionRepository: new DrizzleAgentSessionRepository(database, tenant.IdCompany),
    registry: new AgentRegistry(),
    runner,
    mcpServer: mcp.server,
    observability,
    model: env.OPENAI_MODEL,
    tracingEnabled: env.OPENAI_TRACING_ENABLED,
    traceIncludeSensitiveData: env.OPENAI_TRACE_INCLUDE_SENSITIVE_DATA,
    sessionMutex: sharedSessionMutex,
    activeTurns,
    tenantScope: { CompanyUUID: tenant.CompanyUUID, IdDatabase: tenant.IdDatabase, IdCompany: tenant.IdCompany },
  });

  try {
    await centralRegistry.checkAvailable();
    await mcp.connect();
    let runtimeIsAccepting = true;
    const runtime = new TenantRuntimeGateway({
      allowlist: env.AGENT_RUNTIME_TENANT_ALLOWLIST,
      registry: centralRegistry,
      connections,
      buildRuntime,
    });
    const app = createApp(runtime, {
      checkRegistry: () => centralRegistry.checkAvailable(),
      checkMcp: async () => { await mcp.server.listTools(); },
      getPoolStats: () => connections.getStats(),
      isAccepting: () => runtimeIsAccepting,
    });
    const server = app.listen(env.PORT, () => {
      console.log(`Agent Runtime listening on port ${env.PORT}`);
    });

    let shutdownStarted = false;
    const shutdown = async (signal: string): Promise<void> => {
      if (shutdownStarted) return;
      shutdownStarted = true;
      runtimeIsAccepting = false;
      runtime.stopAccepting();
      console.log(JSON.stringify({ Event: 'RUNTIME_SHUTDOWN_STARTED', Signal: signal }));

      const serverClosed = closeServer(server);
      const drained = await runtime.waitForDrain(env.AGENT_RUNTIME_DRAIN_TIMEOUT_MS);
      if (!drained) {
        console.error(JSON.stringify({
          Event: 'RUNTIME_DRAIN_TIMEOUT',
          PendingRequests: runtime.getActiveRequestCount(),
          ActiveTenantLeases: connections.getStats().activeLeases,
        }));
        server.closeAllConnections?.();
        process.exitCode = 1;
      }

      const closeOperations = [
        mcp.close(),
        centralRegistry.close(),
        connections.close(),
        serverClosed,
      ];
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      const closeResult = await Promise.race([
        Promise.allSettled(closeOperations).then((results) => ({
          timedOut: false,
          failedCount: results.filter((result) => result.status === 'rejected').length,
        })),
        new Promise<{ timedOut: true; failedCount: number }>((resolve) => {
          closeTimer = setTimeout(() => resolve({ timedOut: true, failedCount: 0 }), 5_000);
        }),
      ]);
      if (closeTimer) clearTimeout(closeTimer);
      if (closeResult.timedOut) {
        console.error(JSON.stringify({
          Event: 'RUNTIME_CLOSE_TIMEOUT',
          PendingRequests: runtime.getActiveRequestCount(),
          ActiveTenantLeases: connections.getStats().activeLeases,
        }));
      } else if (closeResult.failedCount > 0) {
        console.error(JSON.stringify({
          Event: 'RUNTIME_CLOSE_FAILED',
          FailedClosures: closeResult.failedCount,
        }));
      }
      process.exit(drained && !closeResult.timedOut && closeResult.failedCount === 0 ? 0 : 1);
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error) {
    await Promise.allSettled([mcp.close(), centralRegistry.close(), connections.close()]);
    throw error;
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
