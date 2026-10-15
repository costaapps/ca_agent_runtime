import { z } from 'zod';

const TenantAllowlistSchema = z.string().transform((value, context) => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value) as unknown;
  } catch {
    context.addIssue({ code: 'custom', message: 'AGENT_RUNTIME_TENANT_ALLOWLIST deve ser um array JSON de UUIDs.' });
    return z.NEVER;
  }

  const parsed = z.array(z.string().uuid()).min(1).safeParse(decoded);
  if (!parsed.success) {
    context.addIssue({ code: 'custom', message: 'AGENT_RUNTIME_TENANT_ALLOWLIST deve ser um array JSON não vazio de UUIDs válidos.' });
    return z.NEVER;
  }

  const normalized = parsed.data.map((uuid) => uuid.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({ code: 'custom', message: 'AGENT_RUNTIME_TENANT_ALLOWLIST não pode conter UUIDs duplicados.' });
    return z.NEVER;
  }
  return normalized;
});

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3101),
  NODE_ENV: z.string().default('development'),
  OPENAI_MODEL: z.string().min(1),
  OPENAI_TRACING_ENABLED: z.enum(['true', 'false']).default('true'),
  OPENAI_TRACE_INCLUDE_SENSITIVE_DATA: z.enum(['true', 'false']).default('false'),
  MCP_SERVER_URL: z.string().url(),
  MCP_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  CENTRAL_DB_HOST: z.string().min(1),
  CENTRAL_DB_PORT: z.coerce.number().int().positive().default(3306),
  CENTRAL_DB_NAME: z.string().min(1),
  CENTRAL_DB_USER: z.string().min(1),
  CENTRAL_DB_PASS: z.string(),
  CENTRAL_DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(4),
  CENTRAL_REGISTRY_CACHE_MS: z.coerce.number().int().positive().default(60000),
  AGENT_RUNTIME_TENANT_ALLOWLIST: TenantAllowlistSchema,
  TENANT_DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(8),
  TENANT_DB_MAX_POOLS: z.coerce.number().int().positive().default(32),
  TENANT_DB_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  AGENT_RUNTIME_DRAIN_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
});

export interface RuntimeEnv {
  PORT: number;
  NODE_ENV: string;
  OPENAI_MODEL: string;
  OPENAI_TRACING_ENABLED: boolean;
  OPENAI_TRACE_INCLUDE_SENSITIVE_DATA: boolean;
  MCP_SERVER_URL: string;
  MCP_TIMEOUT_MS: number;
  CENTRAL_DB_HOST: string;
  CENTRAL_DB_PORT: number;
  CENTRAL_DB_NAME: string;
  CENTRAL_DB_USER: string;
  CENTRAL_DB_PASS: string;
  CENTRAL_DB_CONNECTION_LIMIT: number;
  CENTRAL_REGISTRY_CACHE_MS: number;
  AGENT_RUNTIME_TENANT_ALLOWLIST: string[];
  TENANT_DB_CONNECTION_LIMIT: number;
  TENANT_DB_MAX_POOLS: number;
  TENANT_DB_IDLE_TIMEOUT_MS: number;
  AGENT_RUNTIME_DRAIN_TIMEOUT_MS: number;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): RuntimeEnv {
  const parsed = EnvSchema.parse(source);
  return {
    ...parsed,
    OPENAI_TRACING_ENABLED: parsed.OPENAI_TRACING_ENABLED === 'true',
    OPENAI_TRACE_INCLUDE_SENSITIVE_DATA: parsed.OPENAI_TRACE_INCLUDE_SENSITIVE_DATA === 'true',
  };
}
