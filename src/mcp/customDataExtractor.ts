import type { MCPToolCustomDataExtractor } from '@openai/agents';
import { RuntimeError } from '../errors/RuntimeError.js';
import { ErrorCodes } from '../errors/errorCodes.js';
import type { RuntimeContextData } from '../runtime/RuntimeContext.js';
import { mergeResolved } from '../runtime/ResolvedContext.js';
import { McpObservabilityRegistry, ToolCallTracker } from './observability.js';
import { recordNavigationToolObservation } from '../agents/aidocument/specialists/navigationAgent.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolvedFromMeta(resultMeta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!resultMeta || resultMeta.ca === undefined) return undefined;
  if (!isRecord(resultMeta.ca)) throw new RuntimeError(ErrorCodes.InvalidMcpMetadata, 'MCP result _meta.ca inválido.');
  if (resultMeta.ca.Resolved === undefined) return undefined;
  if (!isRecord(resultMeta.ca.Resolved)) {
    throw new RuntimeError(ErrorCodes.InvalidMcpMetadata, 'MCP result _meta.ca.Resolved inválido.');
  }
  return resultMeta.ca.Resolved;
}

export function createCustomDataExtractor(
  observability: McpObservabilityRegistry,
  tracker = new ToolCallTracker(),
): MCPToolCustomDataExtractor<RuntimeContextData> {
  return async ({ runContext, serverName, toolName, resultMeta, structuredContent, isError, toolOutput, arguments: toolArguments }) => {
    const context = runContext.context as RuntimeContextData;
    const durationMs = tracker.end(context, toolName);
    const output = { structuredContent, resultMeta, isError: isError ?? false, toolOutput };
    recordNavigationToolObservation(
      context,
      toolName,
      toolArguments,
      structuredContent,
      isError ?? false,
      toolOutput,
    );
    const resolved = resultMeta?.ca;
    console.info(JSON.stringify({
      Event: 'MCP_TOOL_RESULT_AFTER',
      ExecutionUUID: context.Execution.ExecutionUUID,
      ToolName: toolName,
      ServerName: serverName,
      Status: isError ? 'ERROR' : 'COMPLETED',
      DurationMs: durationMs,
      HasStructuredContent: structuredContent !== undefined,
      ResolvedKeys: isRecord(resolved) && isRecord(resolved.Resolved) ? Object.keys(resolved.Resolved) : [],
    }));
    const logger = observability.getLogger(context);
    if (logger) {
      await logger.toolResult(toolName, output, durationMs, isError ? 'ERROR' : 'COMPLETED', isError ? 'MCP tool retornou erro.' : undefined);
    }

    const patch = isError ? undefined : resolvedFromMeta(resultMeta);
    if (patch) mergeResolved(context, patch);

    const flowTool = toolName === 'list_flow_actions' || toolName === 'describe_flow_action' || toolName === 'execute_flow_action';
    const navigationTool = toolName === 'list_navigation_destinations' || toolName === 'request_handoff';
    if (isError && !flowTool && !navigationTool) {
      throw new RuntimeError(ErrorCodes.McpToolError, `MCP tool '${toolName}' retornou erro.`);
    }

    return patch ? { ca: { Resolved: patch } } : undefined;
  };
}
