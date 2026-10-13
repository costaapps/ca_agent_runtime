import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DrizzleAiExecutionRepository } from '../../src/database/repositories/aiExecutionRepository.js';
import { DrizzleAgentSessionRepository } from '../../src/database/repositories/aiSessionRepository.js';
import type { RuntimeDatabase } from '../../src/database/connection.js';
import { aiAgentExecution, aiAgentSession } from '../../src/database/schema/index.js';
import { createCentralRegistry } from '../../src/tenancy/CentralRegistry.js';
import { TenantConnectionManager } from '../../src/tenancy/ConnectionManager.js';

const describeWithDatabase = process.env.RUN_TENANT_DB_INTEGRATION_TESTS === '1' ? describe : describe.skip;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável obrigatória para teste de isolamento: ${name}`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} deve ser inteiro positivo.`);
  return value;
}

describeWithDatabase('tenant isolation with MariaDB', () => {
  it('shares same-database pools while scoping Sessions and Turn replay to each company', async () => {
    const registry = createCentralRegistry({
      host: required('TENANT_TEST_REGISTRY_HOST'),
      port: positiveInteger('TENANT_TEST_REGISTRY_PORT', 3306),
      database: required('TENANT_TEST_REGISTRY_NAME'),
      user: required('TENANT_TEST_REGISTRY_USER'),
      password: process.env.TENANT_TEST_REGISTRY_PASSWORD ?? '',
      connectionLimit: 4,
      cacheTtlMs: 60_000,
    });
    const connections = new TenantConnectionManager({ connectionLimit: 4, maxPools: 4, idleTimeoutMs: 60_000 });
    const companyAUUID = required('TENANT_TEST_COMPANY_A_UUID');
    const companyBUUID = required('TENANT_TEST_COMPANY_B_UUID');
    const companyCUUID = required('TENANT_TEST_COMPANY_C_UUID');
    const processLine = 1_900_000_000 + Math.floor(Math.random() * 100_000_000);
    const turnUUID = randomUUID();
    const sessionUUIDs = [randomUUID(), randomUUID(), randomUUID()];
    const executionUUIDs = [randomUUID(), randomUUID(), randomUUID()];
    let descriptors: Awaited<ReturnType<typeof registry.resolve>>[] = [];
    let leases: Awaited<ReturnType<typeof connections.acquire>>[] = [];

    try {
      descriptors = await Promise.all([companyAUUID, companyBUUID, companyCUUID].map((uuid) => registry.resolve(uuid)));
      const [companyA, companyB, companyC] = descriptors as [typeof descriptors[number], typeof descriptors[number], typeof descriptors[number]];
      expect(companyA.IdDatabase).toBe(companyB.IdDatabase);
      expect(companyA.IdCompany).not.toBe(companyB.IdCompany);
      expect(companyC.IdDatabase).not.toBe(companyA.IdDatabase);
      expect(companyC.IdCompany).toBe(companyA.IdCompany);

      for (const descriptor of descriptors) leases.push(await connections.acquire(descriptor));
      const [leaseA, leaseB, leaseC] = leases as [typeof leases[number], typeof leases[number], typeof leases[number]];
      expect(leaseA.db).toBe(leaseB.db);
      expect(leaseC.db).not.toBe(leaseA.db);

      const companyIds = [companyA.IdCompany, companyB.IdCompany, companyC.IdCompany];
      const databases = [leaseA.db, leaseB.db, leaseC.db];
      for (let index = 0; index < 3; index += 1) {
        const db = databases[index]!;
        const sessions = new DrizzleAgentSessionRepository(db, companyIds[index]!);
        const executions = new DrizzleAiExecutionRepository(db, companyIds[index]!);
        const now = new Date();
        const session = await sessions.createSession({
          SessionUUID: sessionUUIDs[index]!,
          IdCompany: companyIds[index]!,
          IdChat: 1,
          IdProcessLine: processLine,
          RootAgent: 'sales-agent',
          AgentConfigurationRevision: null,
          AgentConfigurationJSON: null,
          KnowledgeConfigurationJSON: null,
          Status: 'OPEN',
          StartedAt: now,
          LastActivityAt: now,
          ClosedAt: null,
        });
        await executions.createExecution({
          ExecutionUUID: executionUUIDs[index]!,
          IdCompany: companyIds[index]!,
          IdChat: 1,
          IdProcessLine: processLine,
          IdAIAgentSession: session.IdAIAgentSession,
          TurnUUID: turnUUID,
          TurnInputJSON: '{}',
          TurnPayloadHash: 'a'.repeat(64),
          RequestedAgent: 'sales-agent',
          StartedAt: now,
        });
      }

      for (let index = 0; index < 3; index += 1) {
        const sessions = new DrizzleAgentSessionRepository(databases[index]!, companyIds[index]!);
        const replay = new DrizzleAgentSessionRepository(databases[index]!, companyIds[index]!);
        const session = await sessions.findByProcessLine(processLine);
        expect(session?.SessionUUID).toBe(sessionUUIDs[index]);
        expect((await replay.findExecutionByTurn(turnUUID))?.ExecutionUUID).toBe(executionUUIDs[index]);
      }
    } finally {
      // The UUIDs are generated per run; remove only rows created by this test.
      for (let index = 0; index < leases.length; index += 1) {
        const db = leases[index]!.db as RuntimeDatabase;
        const companyId = descriptors[index]?.IdCompany;
        if (!companyId) continue;
        await db.delete(aiAgentExecution).where(and(
          eq(aiAgentExecution.IdCompany, companyId),
          eq(aiAgentExecution.TurnUUID, turnUUID),
          eq(aiAgentExecution.ExecutionUUID, executionUUIDs[index]!),
        )).catch(() => undefined);
        await db.delete(aiAgentSession).where(and(
          eq(aiAgentSession.IdCompany, companyId),
          eq(aiAgentSession.SessionUUID, sessionUUIDs[index]!),
        )).catch(() => undefined);
      }
      await Promise.all(leases.map((lease) => lease.release()));
      await connections.close();
      await registry.close();
    }
  }, 30_000);
});
