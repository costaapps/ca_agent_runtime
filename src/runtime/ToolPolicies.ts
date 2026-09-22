import type { MCPToolFilterCallable } from '@openai/agents';
import type { RuntimeContextData } from './RuntimeContext.js';
import { hasContextPath } from './ResolvedContext.js';

export interface ToolPolicy {
  enabled: boolean;
  allowedAgents: readonly string[];
  requires: readonly string[];
  meta: readonly string[];
}

export const ToolPolicies: Readonly<Record<string, ToolPolicy>> = {
  get_chat_history: {
    enabled: false,
    allowedAgents: [],
    requires: ['Execution.IdChat'],
    meta: ['Execution.IdChat'],
  },
  get_process_line_flow_state: {
    enabled: false,
    allowedAgents: [],
    requires: ['Execution.IdProcessLine'],
    meta: ['Execution.IdProcessLine'],
  },
  get_products: {
    enabled: false,
    allowedAgents: [],
    requires: ['Execution.IdCompany'],
    meta: ['Execution.IdCompany'],
  },
  get_pricelists: {
    enabled: false,
    allowedAgents: [],
    requires: ['Execution.IdCompany'],
    meta: ['Execution.IdCompany'],
  },
  resolve_product: {
    enabled: false,
    allowedAgents: [],
    requires: ['Execution.IdCompany'],
    meta: ['Execution.IdCompany'],
  },
  get_products_pricelists: {
    enabled: false,
    allowedAgents: [],
    requires: ['Execution.IdCompany', 'Resolved.IdItem'],
    meta: ['Execution.IdCompany', 'Resolved.IdItem'],
  },
  list_flow_actions: {
    enabled: true,
    allowedAgents: ['FlowAgent'],
    requires: ['Execution.ExecutionUUID', 'Execution.IdCompany', 'Execution.IdProcessLine'],
    meta: ['Execution.ExecutionUUID', 'Execution.TurnUUID', 'Execution.IdCompany', 'Execution.IdProcessLine'],
  },
  describe_flow_action: {
    enabled: true,
    allowedAgents: ['FlowAgent'],
    requires: ['Execution.ExecutionUUID', 'Execution.IdCompany', 'Execution.IdProcessLine'],
    meta: ['Execution.ExecutionUUID', 'Execution.TurnUUID', 'Execution.IdCompany', 'Execution.IdProcessLine'],
  },
  execute_flow_action: {
    enabled: true,
    allowedAgents: ['FlowAgent'],
    requires: ['Execution.ExecutionUUID', 'Execution.IdCompany', 'Execution.IdProcessLine'],
    meta: ['Execution.ExecutionUUID', 'Execution.TurnUUID', 'Execution.IdCompany', 'Execution.IdProcessLine'],
  },
  list_navigation_destinations: {
    enabled: true,
    allowedAgents: ['NavigationAgent'],
    requires: ['Execution.ExecutionUUID', 'Execution.IdCompany', 'Execution.IdProcessLine'],
    meta: ['Execution.ExecutionUUID', 'Execution.TurnUUID', 'Execution.IdCompany', 'Execution.IdProcessLine'],
  },
  request_handoff: {
    enabled: true,
    allowedAgents: ['NavigationAgent'],
    requires: ['Execution.ExecutionUUID', 'Execution.IdCompany', 'Execution.IdProcessLine'],
    meta: ['Execution.ExecutionUUID', 'Execution.TurnUUID', 'Execution.IdCompany', 'Execution.IdProcessLine'],
  },
};

export function getToolPolicy(toolName: string): ToolPolicy | undefined {
  return ToolPolicies[toolName];
}

export function isToolAvailable(toolName: string, agentName: string, context: RuntimeContextData): boolean {
  const policy = getToolPolicy(toolName);
  if (!policy || policy.enabled !== true || !policy.allowedAgents.includes(agentName)) return false;
  return policy.requires.every((path) => hasContextPath(context, path));
}

export function createToolFilter(): MCPToolFilterCallable<RuntimeContextData> {
  return async ({ runContext, agent }, tool) =>
    isToolAvailable(tool.name, agent.name, runContext.context as RuntimeContextData);
}
