import { describe, expect, it } from 'vitest';
import { loadEnv, normalizeVectorStoreIds } from '../../src/config/env.js';

const baseEnv = {
  OPENAI_API_KEY: 'test-key',
  OPENAI_MODEL: 'test-model',
  MCP_SERVER_URL: 'http://localhost:3102/mcp',
  DB_HOST: 'localhost',
  DB_USER: 'test',
  DB_PASSWORD: '',
  DB_DATABASE: 'test',
};

describe('ReceptionAgent environment configuration', () => {
  it('normalizes absent and empty Vector Store configuration', () => {
    expect(normalizeVectorStoreIds(undefined)).toEqual([]);
    expect(normalizeVectorStoreIds('')).toEqual([]);
    expect(loadEnv(baseEnv).RECEPTION_AGENT_VECTOR_STORE_IDS).toEqual([]);
  });

  it('trims and deduplicates one or multiple Vector Store IDs', () => {
    expect(normalizeVectorStoreIds(' vs_company,vs_policies, vs_company ,, vs_faq ')).toEqual([
      'vs_company', 'vs_policies', 'vs_faq',
    ]);
    expect(loadEnv({ ...baseEnv, RECEPTION_AGENT_VECTOR_STORE_IDS: 'vs_a, vs_b,vs_a' }).RECEPTION_AGENT_VECTOR_STORE_IDS)
      .toEqual(['vs_a', 'vs_b']);
  });
});
