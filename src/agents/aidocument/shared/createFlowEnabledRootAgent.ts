import { Agent, type MCPServer } from '@openai/agents';
import type { AIDocumentAgentGraph } from '../contracts.js';
import { AIDocumentRootOutputSchema } from '../../../api/contracts/agentTurnOutput.js';
import type { RuntimeContextData } from '../../../runtime/RuntimeContext.js';
import { createFlowAgent, createFlowAgentTool } from '../specialists/flowAgent.js';

export interface FlowEnabledRootAgentConfig {
  name: string;
  handoffDescription: string;
  instructions: string;
  model: string;
  mcpServer: MCPServer;
}

export function createFlowEnabledRootAgent(config: FlowEnabledRootAgentConfig): AIDocumentAgentGraph {
  const flowAgent = createFlowAgent(config.mcpServer, config.model);
  const root = new Agent<RuntimeContextData, typeof AIDocumentRootOutputSchema>({
    name: config.name,
    handoffDescription: config.handoffDescription,
    model: config.model,
    outputType: AIDocumentRootOutputSchema,
    instructions: config.instructions,
    tools: [createFlowAgentTool(flowAgent)],
    mcpServers: [],
  });
  return { root, agents: [root, flowAgent] };
}
