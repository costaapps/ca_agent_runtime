import type { Agent, MCPServer } from '@openai/agents';
import type { RuntimeContextData } from '../../runtime/RuntimeContext.js';
import type { ExecutionLogger } from '../../tracing/ExecutionLogger.js';
import type { AgentConfiguration, AgentContext } from '../../api/contracts/agentTurnInput.js';
import type { KnowledgeConfiguration } from '../../api/contracts/knowledgeConfiguration.js';
import type { KnowledgeSearchService } from '../../knowledge/KnowledgeSearchService.js';

export interface AIDocumentAgentGraph {
  root: Agent<RuntimeContextData, any>;
  agents: Agent<RuntimeContextData, any>[];
}

export interface AIDocumentAgentBuildContext {
  mcpServer: MCPServer;
  model: string;
  runtimeContext: RuntimeContextData;
  logger: ExecutionLogger;
  agentConfiguration?: AgentConfiguration | null;
  agentContext?: AgentContext | null;
  knowledgeConfiguration?: KnowledgeConfiguration;
  knowledgeSearchService?: KnowledgeSearchService;
}

export type ReceptionAgentBuildContext = AIDocumentAgentBuildContext;

export type HostedAgentGraph = AIDocumentAgentGraph;
export type HostedAgentBuildContext = AIDocumentAgentBuildContext;
