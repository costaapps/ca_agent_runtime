import type { Agent, MCPServer } from '@openai/agents';
import type { RuntimeContextData } from '../../runtime/RuntimeContext.js';
import type { ExecutionLogger } from '../../tracing/ExecutionLogger.js';

export interface AIDocumentAgentGraph {
  root: Agent<RuntimeContextData, any>;
  agents: Agent<RuntimeContextData, any>[];
}

export interface AIDocumentAgentBuildContext {
  mcpServer: MCPServer;
  model: string;
  runtimeContext: RuntimeContextData;
  logger: ExecutionLogger;
}

export interface ReceptionAgentBuildContext extends AIDocumentAgentBuildContext {
  vectorStoreIds: readonly string[];
}

export type HostedAgentGraph = AIDocumentAgentGraph;
export type HostedAgentBuildContext = AIDocumentAgentBuildContext;
