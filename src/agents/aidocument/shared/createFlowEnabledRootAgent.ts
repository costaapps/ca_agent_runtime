import type { MCPServer, Tool } from '@openai/agents';
import type { AIDocumentAgentGraph } from '../contracts.js';
import type { RuntimeContextData } from '../../../runtime/RuntimeContext.js';
import { createAgentPlatformRootAgent } from './createAgentPlatformRootAgent.js';

export interface FlowEnabledRootAgentConfig {
  name: string;
  handoffDescription: string;
  instructions: string;
  model: string;
  mcpServer: MCPServer;
  runtimeContext: RuntimeContextData;
  additionalTools?: Tool<RuntimeContextData>[];
}

export function createFlowEnabledRootAgent(config: FlowEnabledRootAgentConfig): AIDocumentAgentGraph {
  return createAgentPlatformRootAgent({
    ...config,
    includeNavigation: false,
  });
}
