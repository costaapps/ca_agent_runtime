import { describe, expect, it } from 'vitest';
import { RunContext } from '@openai/agents';
import { createRuntimeContext } from '../../src/runtime/RuntimeContext.js';
import { createToolFilter, isToolAvailable } from '../../src/runtime/ToolPolicies.js';

const context = createRuntimeContext({
  Agent: 'chat-orchestrator-poc', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789,
  Message: 'Olá', ExpectedOutput: { Name: 'Intent', Description: 'Identifique.' },
}, 'uuid');

describe('ToolPolicies', () => {
  it('allows specialist tools and hides them from orchestrator', () => {
    expect(isToolAvailable('get_chat_history', 'SalesAgent', context)).toBe(true);
    expect(isToolAvailable('get_chat_history', 'ChatOrchestrator', context)).toBe(false);
    expect(isToolAvailable('unknown_tool', 'SalesAgent', context)).toBe(false);
  });

  it('uses state requirements rather than tool ordering', () => {
    context.Resolved = {};
    expect(isToolAvailable('get_chat_history', 'SupportAgent', context)).toBe(true);
    expect(isToolAvailable('get_document_lines', 'SupportAgent', context)).toBe(false);
    expect(isToolAvailable('get_products_pricelists', 'SalesAgent', context)).toBe(false);
    context.Resolved.IdItem = 10;
    expect(isToolAvailable('get_products_pricelists', 'SalesAgent', context)).toBe(true);
  });

  it('exposes all product tools only to SalesAgent', () => {
    for (const toolName of ['get_products', 'get_pricelists', 'resolve_product', 'get_products_pricelists']) {
      expect(isToolAvailable(toolName, 'SalesAgent', context)).toBe(true);
      expect(isToolAvailable(toolName, 'SupportAgent', context)).toBe(false);
      expect(isToolAvailable(toolName, 'ChatOrchestrator', context)).toBe(false);
    }
  });

  it('implements the SDK callable filter', async () => {
    const filter = createToolFilter();
    const allowed = await filter({ runContext: new RunContext(context), agent: { name: 'SalesAgent' } as any, serverName: 'fake' }, { name: 'get_chat_history' } as any);
    const denied = await filter({ runContext: new RunContext(context), agent: { name: 'ChatOrchestrator' } as any, serverName: 'fake' }, { name: 'get_chat_history' } as any);
    expect(allowed).toBe(true);
    expect(denied).toBe(false);
  });

  it('re-evaluates the resolved product requirement dynamically', async () => {
    const filter = createToolFilter();
    context.Resolved = {};
    const runContext = new RunContext(context);
    const before = await filter({ runContext, agent: { name: 'SalesAgent' } as any, serverName: 'fake' }, { name: 'get_products_pricelists' } as any);
    context.Resolved.IdItem = 10;
    const after = await filter({ runContext, agent: { name: 'SalesAgent' } as any, serverName: 'fake' }, { name: 'get_products_pricelists' } as any);
    expect(before).toBe(false);
    expect(after).toBe(true);
  });

  it('allows Flow tools only to FlowAgent and requires the AIDocument execution context', async () => {
    const flowContext = {
      Execution: { ...context.Execution, TurnUUID: '14ed24ea-0000-4000-8000-000000000001' },
      Resolved: {},
    };
    for (const toolName of ['list_flow_actions', 'describe_flow_action', 'execute_flow_action']) {
      expect(isToolAvailable(toolName, 'FlowAgent', flowContext)).toBe(true);
      expect(isToolAvailable(toolName, 'SalesAgent', flowContext)).toBe(false);
      expect(isToolAvailable(toolName, 'SupportAgent', flowContext)).toBe(false);
      expect(isToolAvailable(toolName, 'ChatOrchestrator', flowContext)).toBe(false);
    }
    const resolver = (await import('../../src/mcp/toolMetaResolver.js')).createToolMetaResolver(new (await import('../../src/mcp/observability.js')).McpObservabilityRegistry());
    const meta = await resolver({ runContext: new RunContext(flowContext), serverName: 'fake', toolName: 'list_flow_actions', arguments: {} });
    expect(meta).toEqual({ ca: { Execution: { ExecutionUUID: 'uuid', TurnUUID: '14ed24ea-0000-4000-8000-000000000001', IdCompany: 1003, IdProcessLine: 456 } } });
  });
});
