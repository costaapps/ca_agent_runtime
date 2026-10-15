import {
  MCPServerStreamableHttp,
  type MCPServer,
} from '@openai/agents';
import type { RuntimeEnv } from '../config/env.js';
import { createToolFilter } from '../runtime/ToolPolicies.js';
import type { RuntimeContextData } from '../runtime/RuntimeContext.js';
import { McpObservabilityRegistry, ToolCallTracker } from './observability.js';
import { createToolMetaResolver } from './toolMetaResolver.js';
import { createCustomDataExtractor } from './customDataExtractor.js';

export interface McpClientHandle {
  server: MCPServer;
  connect(): Promise<void>;
  close(): Promise<void>;
}

export function createMcpClient(
  env: Pick<RuntimeEnv, 'MCP_SERVER_URL' | 'MCP_TIMEOUT_MS'>,
  observability: McpObservabilityRegistry,
): McpClientHandle {
  const tracker = new ToolCallTracker();
  const server = new MCPServerStreamableHttp({
    url: env.MCP_SERVER_URL,
    name: 'msg4-mcp',
    cacheToolsList: false,
    timeout: env.MCP_TIMEOUT_MS,
    useStructuredContent: true,
    toolFilter: createToolFilter() as any,
    toolMetaResolver: createToolMetaResolver(observability, tracker) as any,
    customDataExtractor: createCustomDataExtractor(observability, tracker) as any,
    errorFunction: null,
  });

  return {
    server,
    connect: () => server.connect(),
    close: () => server.close(),
  };
}
