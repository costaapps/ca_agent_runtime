import type { MCPToolFilterCallable } from '@openai/agents';
import type { RuntimeContextData } from './RuntimeContext.js';
import { hasContextPath } from './ResolvedContext.js';

export interface ToolPolicy {
  allowedAgents: readonly string[];
  requires: readonly string[];
  meta: readonly string[];
}

export const ToolPolicies: Readonly<Record<string, ToolPolicy>> = {
  get_chat_history: {
    allowedAgents: ['SalesAgent', 'SupportAgent'],
    requires: ['Execution.IdChat'],
    meta: ['Execution.IdChat'],
  },
  get_process_line_flow_state: {
    allowedAgents: ['SalesAgent', 'SupportAgent'],
    requires: ['Execution.IdProcessLine'],
    meta: ['Execution.IdProcessLine'],
  },
  get_products: {
    allowedAgents: ['SalesAgent'],
    requires: ['Execution.IdCompany'],
    meta: ['Execution.IdCompany'],
  },
  get_pricelists: {
    allowedAgents: ['SalesAgent'],
    requires: ['Execution.IdCompany'],
    meta: ['Execution.IdCompany'],
  },
  resolve_product: {
    allowedAgents: ['SalesAgent'],
    requires: ['Execution.IdCompany'],
    meta: ['Execution.IdCompany'],
  },
  get_products_pricelists: {
    allowedAgents: ['SalesAgent'],
    requires: ['Execution.IdCompany', 'Resolved.IdItem'],
    meta: ['Execution.IdCompany', 'Resolved.IdItem'],
  },
};

export function getToolPolicy(toolName: string): ToolPolicy | undefined {
  return ToolPolicies[toolName];
}

export function isToolAvailable(toolName: string, agentName: string, context: RuntimeContextData): boolean {
  const policy = getToolPolicy(toolName);
  if (!policy || !policy.allowedAgents.includes(agentName)) return false;
  return policy.requires.every((path) => hasContextPath(context, path));
}

export function createToolFilter(): MCPToolFilterCallable<RuntimeContextData> {
  return async ({ runContext, agent }, tool) =>
    isToolAvailable(tool.name, agent.name, runContext.context as RuntimeContextData);
}
