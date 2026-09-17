import 'dotenv/config';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDatabase, closeDatabase } from './database/connection.js';
import { DrizzleAiExecutionRepository } from './database/repositories/aiExecutionRepository.js';
import { DrizzleAgentSessionRepository } from './database/repositories/aiSessionRepository.js';
import { AgentRegistry } from './agents/AgentRegistry.js';
import { createOpenAIRunner } from './openai/runner.js';
import { createMcpClient } from './mcp/client.js';
import { McpObservabilityRegistry } from './mcp/observability.js';
import { AgentRuntime } from './runtime/AgentRuntime.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const database = createDatabase(env);
  const observability = new McpObservabilityRegistry();
  const mcp = createMcpClient(env, observability);

  try {
    await mcp.connect();
    const runtime = new AgentRuntime({
      repository: new DrizzleAiExecutionRepository(database.db),
      sessionRepository: new DrizzleAgentSessionRepository(database.db),
      registry: new AgentRegistry(undefined, undefined, { receptionAgentVectorStoreIds: env.RECEPTION_AGENT_VECTOR_STORE_IDS }),
      runner: createOpenAIRunner(),
      mcpServer: mcp.server,
      observability,
      model: env.OPENAI_MODEL,
      tracingEnabled: env.OPENAI_TRACING_ENABLED,
      traceIncludeSensitiveData: env.OPENAI_TRACE_INCLUDE_SENSITIVE_DATA,
    });
    const app = createApp(runtime);
    const server = app.listen(env.PORT, () => {
      console.log(`Agent Runtime listening on port ${env.PORT}`);
    });

    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}; shutting down.`);
      server.close(async () => {
        await mcp.close();
        await closeDatabase(database);
        process.exit(0);
      });
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error) {
    await mcp.close().catch(() => undefined);
    await closeDatabase(database).catch(() => undefined);
    throw error;
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
