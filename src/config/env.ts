import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3101),
  NODE_ENV: z.string().default('development'),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  OPENAI_TRACING_ENABLED: z.enum(['true', 'false']).default('true'),
  OPENAI_TRACE_INCLUDE_SENSITIVE_DATA: z.enum(['true', 'false']).default('false'),
  MCP_SERVER_URL: z.string().url(),
  MCP_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_DATABASE: z.string().min(1),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),
  RECEPTION_AGENT_VECTOR_STORE_IDS: z.string().default(''),
});

export interface RuntimeEnv {
  PORT: number;
  NODE_ENV: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_TRACING_ENABLED: boolean;
  OPENAI_TRACE_INCLUDE_SENSITIVE_DATA: boolean;
  MCP_SERVER_URL: string;
  MCP_TIMEOUT_MS: number;
  DB_HOST: string;
  DB_PORT: number;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_DATABASE: string;
  DB_CONNECTION_LIMIT: number;
  RECEPTION_AGENT_VECTOR_STORE_IDS: string[];
}

export function normalizeVectorStoreIds(value: string | undefined): string[] {
  return [...new Set((value ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  const parsed = EnvSchema.parse(source);
  return {
    ...parsed,
    OPENAI_TRACING_ENABLED: parsed.OPENAI_TRACING_ENABLED === 'true',
    OPENAI_TRACE_INCLUDE_SENSITIVE_DATA: parsed.OPENAI_TRACE_INCLUDE_SENSITIVE_DATA === 'true',
    RECEPTION_AGENT_VECTOR_STORE_IDS: normalizeVectorStoreIds(parsed.RECEPTION_AGENT_VECTOR_STORE_IDS),
  };
}
