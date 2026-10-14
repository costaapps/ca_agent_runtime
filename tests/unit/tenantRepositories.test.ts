import { MySqlDialect } from 'drizzle-orm/mysql-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { RuntimeDatabase } from '../../src/database/connection.js';
import { DrizzleAiExecutionRepository } from '../../src/database/repositories/aiExecutionRepository.js';
import { DrizzleAgentSessionRepository } from '../../src/database/repositories/aiSessionRepository.js';
import type { NewAIAgentExecution } from '../../src/database/schema/index.js';

interface RecordedOperation {
  kind: 'select' | 'insert' | 'update' | 'delete';
  table?: unknown;
  where?: { sql: string; params: unknown[] };
  joins: Array<{ table: unknown; where: { sql: string; params: unknown[] } }>;
  values?: unknown;
  set?: unknown;
}

class RecordingDatabase {
  private readonly dialect = new MySqlDialect();
  readonly operations: RecordedOperation[] = [];
  readonly selectResults: unknown[][] = [];
  readonly mutationResults: unknown[] = [];

  select(_fields?: unknown): RecordingQuery {
    return new RecordingQuery(this, 'select');
  }

  insert(_table: unknown): RecordingQuery {
    return new RecordingQuery(this, 'insert');
  }

  update(_table: unknown): RecordingQuery {
    return new RecordingQuery(this, 'update');
  }

  delete(_table: unknown): RecordingQuery {
    return new RecordingQuery(this, 'delete');
  }

  record(operation: RecordedOperation): unknown {
    this.operations.push(operation);
    if (operation.kind === 'select') return this.selectResults.shift() ?? [];
    return this.mutationResults.shift() ?? [];
  }

  query(sql: SQL): { sql: string; params: unknown[] } {
    const result = this.dialect.sqlToQuery(sql);
    return { sql: result.sql, params: result.params };
  }
}

class RecordingQuery implements PromiseLike<unknown> {
  private readonly operation: RecordedOperation;
  private readonly db: RecordingDatabase;

  constructor(db: RecordingDatabase, kind: RecordedOperation['kind']) {
    this.db = db;
    this.operation = { kind, joins: [] };
  }

  from(table: unknown): this {
    this.operation.table = table;
    return this;
  }

  leftJoin(table: unknown, condition: SQL): this {
    this.operation.joins.push({ table, where: this.db.query(condition) });
    return this;
  }

  where(condition: SQL | undefined): this {
    if (condition) this.operation.where = this.db.query(condition);
    return this;
  }

  orderBy(..._expressions: unknown[]): this {
    return this;
  }

  limit(_limit: number): this {
    return this;
  }

  set(values: unknown): this {
    this.operation.set = values;
    return this;
  }

  values(values: unknown): this {
    this.operation.values = values;
    return this;
  }

  recordedWhere(): RecordedOperation['where'] {
    return this.operation.where;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.db.record(this.operation)).then(onfulfilled, onrejected);
  }
}

function asRuntimeDatabase(db: RecordingDatabase): RuntimeDatabase {
  return db as unknown as RuntimeDatabase;
}

const sessionRecord = {
  IdAIAgentSession: 22,
  SessionUUID: 'session-company-44',
  IdCompany: 44,
  IdChat: 100,
  IdProcessLine: 300,
  RootAgent: 'reception-agent',
  AgentConfigurationRevision: null,
  AgentConfigurationJSON: null,
  KnowledgeConfigurationJSON: null,
  Status: 'OPEN' as const,
  StartedAt: new Date('2026-01-01T00:00:00Z'),
  LastActivityAt: new Date('2026-01-01T00:00:00Z'),
  ClosedAt: null,
};

const executionRecord: NewAIAgentExecution = {
  ExecutionUUID: 'execution-company-44',
  IdCompany: 44,
  TurnUUID: 'turn-shared-between-tenants',
  RequestedAgent: 'reception-agent',
  StartedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('tenant-bound Drizzle repositories', () => {
  it('rejects invalid tenant scope and refuses cross-company session inserts', async () => {
    const db = new RecordingDatabase();
    expect(() => new DrizzleAgentSessionRepository(asRuntimeDatabase(db), 0)).toThrow(/IdCompany/);
    expect(() => new DrizzleAiExecutionRepository(asRuntimeDatabase(db), -1)).toThrow(/IdCompany/);

    const sessions = new DrizzleAgentSessionRepository(asRuntimeDatabase(db), 44);
    await expect(sessions.createSession({ ...sessionRecord, IdCompany: 45 })).rejects.toThrow(/empresa diferente/);
    expect(db.operations).toHaveLength(0);
  });

  it('binds process-line and session UUID operations to the repository company', async () => {
    const db = new RecordingDatabase();
    db.selectResults.push([], [sessionRecord], []);
    const sessions = new DrizzleAgentSessionRepository(asRuntimeDatabase(db), 44);

    await sessions.findByProcessLine(300);
    await sessions.getItems(sessionRecord.SessionUUID);
    await sessions.getItems('uuid-owned-by-company-45');

    expect(db.operations[0]?.where).toMatchObject({
      sql: expect.stringContaining('`AIAgentSession`.`IdCompany` = ?'),
      params: expect.arrayContaining([44, 300]),
    });
    expect(db.operations[1]?.where).toMatchObject({
      sql: expect.stringContaining('`AIAgentSession`.`IdCompany` = ?'),
      params: expect.arrayContaining([44, sessionRecord.SessionUUID]),
    });
    expect(db.operations[2]?.where?.sql).toContain('`AIAgentSessionItem`.`IdAIAgentSession` = ?');
    const ownershipPredicate = db.operations[2]?.where?.params[1] as RecordingQuery | undefined;
    expect(ownershipPredicate?.recordedWhere()).toMatchObject({
      sql: expect.stringContaining('`AIAgentSession`.`IdCompany` = ?'),
      params: expect.arrayContaining([44, sessionRecord.IdAIAgentSession]),
    });
    expect(db.operations[3]?.where).toMatchObject({
      sql: expect.stringContaining('`AIAgentSession`.`IdCompany` = ?'),
      params: expect.arrayContaining([44, 'uuid-owned-by-company-45']),
    });
  });

  it('keeps session close and item reads/deletes inside the bound company', async () => {
    const closeDb = new RecordingDatabase();
    closeDb.selectResults.push([sessionRecord], [{ ...sessionRecord, Status: 'CLOSED' }]);
    const closeRepository = new DrizzleAgentSessionRepository(asRuntimeDatabase(closeDb), 44);
    await closeRepository.closeSession(sessionRecord.IdProcessLine);
    expect(closeDb.operations[1]?.where).toMatchObject({
      sql: expect.stringContaining('`AIAgentSession`.`IdCompany` = ?'),
      params: expect.arrayContaining([44, sessionRecord.IdProcessLine]),
    });

    const itemDb = new RecordingDatabase();
    itemDb.selectResults.push(
      [sessionRecord],
      [{ IdAIAgentSessionItem: 77, IdAIAgentSession: sessionRecord.IdAIAgentSession, Sequence: 1, ItemJSON: '{"role":"user","content":"x"}' }],
      [sessionRecord],
    );
    const itemRepository = new DrizzleAgentSessionRepository(asRuntimeDatabase(itemDb), 44);
    await itemRepository.popItem(sessionRecord.SessionUUID);
    await itemRepository.clearItems(sessionRecord.SessionUUID);

    for (const operation of [itemDb.operations[1], itemDb.operations[2], itemDb.operations[4]]) {
      expect(operation?.where?.sql).toContain('exists');
      const ownershipPredicate = operation?.where?.params.find((param) => param instanceof RecordingQuery) as RecordingQuery | undefined;
      expect(ownershipPredicate?.recordedWhere()).toMatchObject({
        sql: expect.stringContaining('`AIAgentSession`.`IdCompany` = ?'),
        params: expect.arrayContaining([44, sessionRecord.IdAIAgentSession]),
      });
    }
  });

  it('scopes replay lookup by both company and TurnUUID', async () => {
    const db = new RecordingDatabase();
    db.selectResults.push([]);
    const sessions = new DrizzleAgentSessionRepository(asRuntimeDatabase(db), 45);

    await expect(sessions.findExecutionByTurn(executionRecord.TurnUUID!)).resolves.toBeUndefined();

    const query = db.operations[0];
    expect(query?.where).toMatchObject({
      sql: expect.stringContaining('`AIAgentExecution`.`IdCompany` = ?'),
      params: expect.arrayContaining([45, executionRecord.TurnUUID]),
    });
    expect(query?.joins[0]?.where).toMatchObject({
      sql: expect.stringContaining('`AIAgentSession`.`IdCompany` = ?'),
      params: expect.arrayContaining([45]),
    });
  });

  it('rejects execution item links owned by a different company', async () => {
    const db = new RecordingDatabase();
    db.selectResults.push([sessionRecord], []);
    const sessions = new DrizzleAgentSessionRepository(asRuntimeDatabase(db), 44);

    await expect(sessions.appendItems(sessionRecord.SessionUUID, 'foreign-execution-uuid', [
      { role: 'user', content: 'message' },
    ])).rejects.toThrow(/não pertence à empresa/);
    expect(db.operations).toHaveLength(2);
    expect(db.operations[1]?.where).toMatchObject({
      sql: expect.stringContaining('`AIAgentExecution`.`IdCompany` = ?'),
      params: expect.arrayContaining([44, 'foreign-execution-uuid']),
    });
  });

  it('scopes execution updates and verifies log ownership before inserting', async () => {
    const db = new RecordingDatabase();
    const executions = new DrizzleAiExecutionRepository(asRuntimeDatabase(db), 44);

    await expect(executions.createExecution({ ...executionRecord, IdCompany: 45 })).rejects.toThrow(/empresa diferente/);
    expect(db.operations).toHaveLength(0);

    db.mutationResults.push([{ insertId: 91 }]);
    await executions.createExecution(executionRecord);
    expect(db.operations[0]?.values).toMatchObject({ IdCompany: 44 });

    await executions.finishExecution(91, {
      Success: 'Y',
      FinishedAt: new Date('2026-01-01T00:00:01Z'),
      DurationMs: 1,
    });
    expect(db.operations[1]?.where).toMatchObject({
      sql: expect.stringContaining('`AIAgentExecution`.`IdCompany` = ?'),
      params: expect.arrayContaining([91, 44]),
    });

    db.selectResults.push([]);
    await expect(executions.appendLog(92, { Sequence: 1, EventType: 'RUN_STARTED' })).rejects.toThrow(/escopo da empresa/);
    expect(db.operations).toHaveLength(3);

    db.selectResults.push([{ id: 91 }]);
    db.mutationResults.push([]);
    await executions.appendLog(91, { Sequence: 1, EventType: 'RUN_STARTED' });
    expect(db.operations[3]?.where).toMatchObject({
      sql: expect.stringContaining('`AIAgentExecution`.`IdCompany` = ?'),
      params: expect.arrayContaining([91, 44]),
    });
    expect(db.operations[4]?.kind).toBe('insert');
  });
});
