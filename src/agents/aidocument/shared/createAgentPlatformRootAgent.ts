import { Agent, type MCPServer, type Tool } from '@openai/agents';
import { AgentRootOutputSchema } from '../../../api/contracts/agentTurnOutput.js';
import type { RuntimeContextData } from '../../../runtime/RuntimeContext.js';
import type { HostedAgentGraph } from '../contracts.js';
import { createFlowAgent, createFlowAgentTool } from '../specialists/flowAgent.js';
import { createNavigationAgent, createNavigationAgentTool } from '../specialists/navigationAgent.js';

export interface AgentPlatformRootAgentConfig {
  name: string;
  handoffDescription: string;
  instructions: string;
  companyInstructions?: string | null;
  model: string;
  mcpServer: MCPServer;
  runtimeContext: RuntimeContextData;
  includeFlow?: boolean;
  includeNavigation?: boolean;
  additionalTools?: Tool<RuntimeContextData>[];
}

function runtimeContextInstructions(context: RuntimeContextData): string {
  return [
    'O Runtime fornece um contexto interno readonly para este turno. Não exponha seus mecanismos, IDs ou namespaces ao cliente.',
    `TurnSource=${context.Execution.TurnSource ?? 'MESSAGE'}`,
    `ProcessContextRevision=${context.Execution.ProcessContextRevision ?? 0}`,
    `ProcessContext=${JSON.stringify(context.ProcessContext ?? { System: {}, Facts: {}, BusinessReferences: {}, CurrentIntent: {} })}`,
    `ActivationContext=${JSON.stringify(context.ActivationContext ?? null)}`,
    'Use ProcessContext autoritativo para evitar perguntas repetidas. Nunca altere BusinessReferences; proponha somente Facts e CurrentIntent em ContextUpdates quando aplicável.',
  ].join('\n');
}

export function createAgentPlatformRootAgent(config: AgentPlatformRootAgentConfig): HostedAgentGraph {
  const agents: HostedAgentGraph['agents'] = [];
  const tools: Tool<RuntimeContextData>[] = [];

  if (config.includeFlow !== false) {
    const flowAgent = createFlowAgent(config.mcpServer, config.model);
    tools.push(createFlowAgentTool(flowAgent));
    agents.push(flowAgent);
  }

  if (config.includeNavigation !== false) {
    const navigationAgent = createNavigationAgent(config.mcpServer, config.model, config.runtimeContext);
    tools.push(createNavigationAgentTool(navigationAgent));
    agents.push(navigationAgent);
  }

  const companyInstructions = config.companyInstructions ?? '';
  const instructions = [
    `[TECHNICAL INSTRUCTIONS]\n${config.instructions}`,
    `[COMPANY AGENT CONFIGURATION]\n${companyInstructions || '(nenhuma instrução empresarial configurada)'}`,
    `[RUNTIME CONTEXT]\n${runtimeContextInstructions(config.runtimeContext)}`,
  ].join('\n\n');
  const root = new Agent<RuntimeContextData, typeof AgentRootOutputSchema>({
    name: config.name,
    handoffDescription: config.handoffDescription,
    model: config.model,
    outputType: AgentRootOutputSchema,
    instructions,
    tools: [...tools, ...(config.additionalTools ?? [])],
    mcpServers: [],
  });

  return { root, agents: [root, ...agents] };
}
