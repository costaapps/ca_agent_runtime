import { describe, expect, it, vi } from 'vitest';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { TenantOpenAIKeyRepository, createTenantOpenAIKeyResolver } from '../../src/database/repositories/tenantOpenAIKeyRepository.js';
import { TenantOpenAICredentialResolver } from '../../src/knowledge/credentials/TenantOpenAICredentialResolver.js';
import { ErrorCodes } from '../../src/errors/errorCodes.js';
import { configuredKnowledge } from '../helpers/knowledgeConfiguration.js';

describe('tenant OpenAI key lookup', () => {
  it('scopes the lookup by IdCompany and OPENAIKEY and trims the returned value', async () => {
    const execute = vi.fn().mockResolvedValue([{ Value: ' company-key ' }]);
    const repository = new TenantOpenAIKeyRepository({ execute }, 501);
    await expect(repository.findOpenAIKey()).resolves.toBe('company-key');
    const statement = execute.mock.calls[0]![0];
    const query = new MySqlDialect().sqlToQuery(statement);
    expect(query.sql).toContain('GeneralSettings');
    expect(query.sql).toContain('UPPER(`Param`) = \'OPENAIKEY\'');
    expect(query.sql).toContain('LIMIT 2');
    expect(query.params).toContain(501);
  });

  it.each([
    { rows: [] as Array<{ Value: string }> },
    { rows: [{ Value: '' }] },
    { rows: [{ Value: 'first' }, { Value: 'duplicate' }] },
  ])('rejects missing, empty or duplicate configuration without exposing values', async ({ rows }) => {
    const repository = new TenantOpenAIKeyRepository({ execute: vi.fn().mockResolvedValue(rows) }, 501);
    await expect(repository.findOpenAIKey()).rejects.toMatchObject({ code: ErrorCodes.OpenAICredentialNotConfigured });
    await expect(repository.findOpenAIKey()).rejects.not.toThrow(/first|duplicate/);
  });

  it('memoizes only within the resolver instance and maps the legacy Knowledge descriptor', async () => {
    const firstExecute = vi.fn().mockResolvedValue([{ Value: 'company-one' }]);
    const secondExecute = vi.fn().mockResolvedValue([{ Value: 'company-two' }]);
    const first = createTenantOpenAIKeyResolver({ execute: firstExecute } as never, 501);
    const second = createTenantOpenAIKeyResolver({ execute: secondExecute } as never, 501);
    const credential = new TenantOpenAICredentialResolver(first);
    const connection = configuredKnowledge.Connections[0]!;
    await expect(credential.resolve(connection)).resolves.toBe('company-one');
    await expect(first()).resolves.toBe('company-one');
    await expect(second()).resolves.toBe('company-two');
    expect(firstExecute).toHaveBeenCalledTimes(1);
    expect(secondExecute).toHaveBeenCalledTimes(1);
  });
});
