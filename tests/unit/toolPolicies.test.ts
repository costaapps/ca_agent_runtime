import { describe, expect, it } from 'vitest';
import { RunContext } from '@openai/agents';
import { createRuntimeContext } from '../../src/runtime/RuntimeContext.js';
import { createToolFilter, isToolAvailable } from '../../src/runtime/ToolPolicies.js';

const context = createRuntimeContext({
  Agent: 'chat-orchestrator-poc', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789,
  Message: 'Olá', ExpectedOutput: { Name: 'Intent', Description: 'Identifique.' },
}, 'uuid');

describe('ToolPolicies', () => {
  it('keeps the legacy and product tools disabled for every Agent', () => {
    const disabledTools = [
      'get_chat_history',
      'get_process_line_flow_state',
      'get_products',
      'get_pricelists',
      'resolve_product',
      'get_products_pricelists',
    ];
    for (const toolName of disabledTools) {
      for (const agentName of ['SalesAgent', 'SupportAgent', 'FlowAgent', 'ReceptionAgent', 'ChatOrchestrator']) {
        expect(isToolAvailable(toolName, agentName, context)).toBe(false);
      }
    }
    expect(isToolAvailable('unknown_tool', 'SalesAgent', context)).toBe(false);
  });

  it('exposes Flow tools only to FlowAgent', async () => {
    const flowContext = {
      Execution: { ...context.Execution, TurnUUID: '14ed24ea-0000-4000-8000-000000000001' },
      ProcessContext: { System: {}, Facts: {}, BusinessReferences: {}, CurrentIntent: {} },
      ActivationContext: null,
      Resolved: {},
    };
    for (const toolName of ['list_flow_actions', 'describe_flow_action', 'execute_flow_action']) {
      expect(isToolAvailable(toolName, 'FlowAgent', flowContext)).toBe(true);
      expect(isToolAvailable(toolName, 'SalesAgent', flowContext)).toBe(false);
      expect(isToolAvailable(toolName, 'SupportAgent', flowContext)).toBe(false);
      expect(isToolAvailable(toolName, 'ReceptionAgent', flowContext)).toBe(false);
      expect(isToolAvailable(toolName, 'ChatOrchestrator', flowContext)).toBe(false);
    }
  });

  it('exposes Navigation tools only to NavigationAgent and sends minimal metadata', async () => {
    const navigationContext = {
      Execution: { ...context.Execution, TurnUUID: '14ed24ea-0000-4000-8000-000000000001' },
      ProcessContext: { System: {}, Facts: {}, BusinessReferences: {}, CurrentIntent: {} },
      ActivationContext: null,
      Resolved: {},
    };
    for (const toolName of ['list_navigation_destinations', 'request_handoff']) {
      expect(isToolAvailable(toolName, 'NavigationAgent', navigationContext)).toBe(true);
      expect(isToolAvailable(toolName, 'SalesAgent', navigationContext)).toBe(false);
      expect(isToolAvailable(toolName, 'ReceptionAgent', navigationContext)).toBe(false);
      expect(isToolAvailable(toolName, 'FlowAgent', navigationContext)).toBe(false);
    }
    const resolver = (await import('../../src/mcp/toolMetaResolver.js')).createToolMetaResolver(new (await import('../../src/mcp/observability.js')).McpObservabilityRegistry());
    const meta = await resolver({ runContext: new RunContext(navigationContext), serverName: 'fake', toolName: 'request_handoff', arguments: { DestinationRef: 'nav_sales', Reason: 'Compra', Summary: 'Cliente quer comprar' } });
    expect(meta).toEqual({ ca: { Execution: { ExecutionUUID: 'uuid', TurnUUID: '14ed24ea-0000-4000-8000-000000000001', IdCompany: 1003, IdProcessLine: 456 } } });
  });

  it('implements the fail-closed SDK callable filter', async () => {
    const filter = createToolFilter();
    const allowed = await filter({ runContext: new RunContext(context), agent: { name: 'SalesAgent' } as any, serverName: 'fake' }, { name: 'get_chat_history' } as any);
    const flowContext = {
      Execution: { ...context.Execution, TurnUUID: '14ed24ea-0000-4000-8000-000000000001' },
      ProcessContext: { System: {}, Facts: {}, BusinessReferences: {}, CurrentIntent: {} },
      ActivationContext: null,
      Resolved: {},
    };
    const flowAllowed = await filter({ runContext: new RunContext(flowContext), agent: { name: 'FlowAgent' } as any, serverName: 'fake' }, { name: 'list_flow_actions' } as any);
    expect(allowed).toBe(false);
    expect(flowAllowed).toBe(true);
  });

  it('requires the AIDocument execution context for Flow tools', async () => {
    const flowContext = {
      Execution: { ...context.Execution, TurnUUID: '14ed24ea-0000-4000-8000-000000000001' },
      ProcessContext: { System: {}, Facts: {}, BusinessReferences: {}, CurrentIntent: {} },
      ActivationContext: null,
      Resolved: {},
    };
    for (const toolName of ['list_flow_actions', 'describe_flow_action', 'execute_flow_action']) {
      expect(isToolAvailable(toolName, 'FlowAgent', flowContext)).toBe(true);
    }
    const resolver = (await import('../../src/mcp/toolMetaResolver.js')).createToolMetaResolver(new (await import('../../src/mcp/observability.js')).McpObservabilityRegistry());
    const meta = await resolver({ runContext: new RunContext(flowContext), serverName: 'fake', toolName: 'list_flow_actions', arguments: {} });
    expect(meta).toEqual({ ca: { Execution: { ExecutionUUID: 'uuid', TurnUUID: '14ed24ea-0000-4000-8000-000000000001', IdCompany: 1003, IdProcessLine: 456 } } });
  });
});
