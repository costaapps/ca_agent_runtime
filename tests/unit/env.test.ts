import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

const baseEnv = {
  OPENAI_API_KEY: 'test-key',
  OPENAI_MODEL: 'test-model',
  MCP_SERVER_URL: 'http://localhost:3102/mcp',
  DB_HOST: 'localhost',
  DB_USER: 'test',
  DB_PASSWORD: '',
  DB_DATABASE: 'test',
};

describe('Runtime environment configuration', () => {
  it('does not require a Reception-specific Vector Store', () => {
    expect(loadEnv(baseEnv).OPENAI_API_KEY).toBe('test-key');
    expect(loadEnv(baseEnv)).not.toHaveProperty('RECEPTION_AGENT_VECTOR_STORE_IDS');
  });
});
