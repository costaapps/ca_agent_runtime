import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

const baseEnv = {
  OPENAI_API_KEY: 'test-key',
  OPENAI_MODEL: 'test-model',
  MCP_SERVER_URL: 'http://localhost:3102/mcp',
  CENTRAL_DB_HOST: 'localhost',
  CENTRAL_DB_NAME: 'registry',
  CENTRAL_DB_USER: 'test',
  CENTRAL_DB_PASS: '',
  AGENT_RUNTIME_TENANT_ALLOWLIST: '["d2719f62-8a67-4fd5-a6ae-411a6a3ef177"]',
};

describe('Runtime environment configuration', () => {
  it('does not require a Reception-specific Vector Store', () => {
    expect(loadEnv(baseEnv).OPENAI_API_KEY).toBe('test-key');
    expect(loadEnv(baseEnv)).not.toHaveProperty('RECEPTION_AGENT_VECTOR_STORE_IDS');
  });

  it('requires a non-empty unique allowlist and normalizes UUIDs', () => {
    expect(loadEnv(baseEnv).AGENT_RUNTIME_TENANT_ALLOWLIST).toEqual(['d2719f62-8a67-4fd5-a6ae-411a6a3ef177']);
    expect(() => loadEnv({ ...baseEnv, AGENT_RUNTIME_TENANT_ALLOWLIST: '[]' })).toThrow();
    expect(() => loadEnv({ ...baseEnv, AGENT_RUNTIME_TENANT_ALLOWLIST: '["D2719F62-8A67-4FD5-A6AE-411A6A3EF177","d2719f62-8a67-4fd5-a6ae-411a6a3ef177"]' })).toThrow();
  });
});
