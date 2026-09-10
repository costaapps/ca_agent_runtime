import type { MCPToolMetaResolver } from '@openai/agents';
import { RuntimeError } from '../errors/RuntimeError.js';
import { ErrorCodes } from '../errors/errorCodes.js';
import type { RuntimeContextData } from '../runtime/RuntimeContext.js';
import { getToolPolicy } from '../runtime/ToolPolicies.js';
import { getContextPath, pickContextPaths } from '../runtime/ResolvedContext.js';
import { McpObservabilityRegistry, ToolCallTracker } from './observability.js';

export function createToolMetaResolver(
  observability: McpObservabilityRegistry,
  tracker = new ToolCallTracker(),
): MCPToolMetaResolver<RuntimeContextData> {
  return async ({ runContext, toolName, arguments: toolArguments }) => {
    const context = runContext.context as RuntimeContextData;
    const policy = getToolPolicy(toolName);
    if (!policy) {
      throw new RuntimeError(ErrorCodes.MissingContext, `Tool '${toolName}' não possui policy.`);
    }

    const missing = policy.requires.filter((path) => {
      const value = getContextPath(context, path);
      return value === undefined || value === null;
    });
    if (missing.length > 0) {
      throw new RuntimeError(ErrorCodes.MissingContext, `Contexto ausente para '${toolName}': ${missing.join(', ')}.`);
    }

    const meta = { ca: pickContextPaths(context, policy.meta) };
    tracker.begin(context, toolName);
    const logger = observability.getLogger(context);
    if (logger) {
      await logger.toolCall(toolName, { Arguments: toolArguments ?? {}, Meta: meta });
    }
    return meta;
  };
}
