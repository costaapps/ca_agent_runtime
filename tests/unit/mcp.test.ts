import { describe, expect, it, vi } from 'vitest';
import { RunContext } from '@openai/agents';
import { createRuntimeContext } from '../../src/runtime/RuntimeContext.js';
import { McpObservabilityRegistry, ToolCallTracker } from '../../src/mcp/observability.js';
import { createToolMetaResolver } from '../../src/mcp/toolMetaResolver.js';
import { createCustomDataExtractor } from '../../src/mcp/customDataExtractor.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { ExecutionLogger } from '../../src/tracing/ExecutionLogger.js';

function makeContext() {
  return createRuntimeContext({
    Agent: 'chat-orchestrator-poc', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789,
    Message: 'Olá', ExpectedOutput: { Name: 'Intent', Description: 'Identifique.' },
  }, 'uuid');
}

describe('MCP context integration', () => {
  it('sends only policy metadata and merges returned Resolved data', async () => {
    const context = makeContext();
    const repository = new MemoryRepository();
    const logger = new ExecutionLogger(repository, 1);
    const registry = new McpObservabilityRegistry();
    registry.register(context, logger);
    const tracker = new ToolCallTracker();
    const resolver = createToolMetaResolver(registry, tracker);
    const extractor = createCustomDataExtractor(registry, tracker);
    const runContext = new RunContext(context);

    const meta = await resolver({ runContext, serverName: 'fake', toolName: 'get_chat_history', arguments: {} });
    expect(meta).toEqual({ ca: { Execution: { IdChat: 123 } } });
    expect(meta).not.toHaveProperty('ca.Execution.IdCompany');
    await extractor({
      runContext,
      serverName: 'fake',
      toolName: 'get_chat_history',
      toolDisplayName: 'get_chat_history',
      arguments: {},
      resultMeta: { ca: { Resolved: { IdDocument: 987 } } },
      structuredContent: { Messages: [] },
      isError: false,
      toolOutput: { Messages: [] },
    });
    expect(context.Resolved).toEqual({ IdDocument: 987 });
    expect(repository.logs.map((entry) => entry.data.EventType)).toEqual(['MCP_TOOL_CALL', 'MCP_TOOL_RESULT']);
  });

  it('fails on conflicting technical identity and records tool errors', async () => {
    const context = makeContext();
    context.Resolved.IdDocument = 987;
    const registry = new McpObservabilityRegistry();
    const tracker = new ToolCallTracker();
    const extractor = createCustomDataExtractor(registry, tracker);
    await expect(extractor({
      runContext: new RunContext(context), serverName: 'fake', toolName: 'get_chat_history', toolDisplayName: 'get_chat_history',
      arguments: {}, resultMeta: { ca: { Resolved: { IdDocument: 999 } } }, structuredContent: {}, isError: false, toolOutput: {},
    })).rejects.toThrow('Resolved context');
  });

  it('resolves metadata for the product tool chain without leaking the full context', async () => {
    const context = makeContext();
    const registry = new McpObservabilityRegistry();
    const tracker = new ToolCallTracker();
    const resolver = createToolMetaResolver(registry, tracker);
    const runContext = new RunContext(context);

    await expect(resolver({ runContext, serverName: 'fake', toolName: 'get_products', arguments: { ItemName: 'carro' } }))
      .resolves.toEqual({ ca: { Execution: { IdCompany: 1003 } } });
    await expect(resolver({ runContext, serverName: 'fake', toolName: 'get_pricelists', arguments: {} }))
      .resolves.toEqual({ ca: { Execution: { IdCompany: 1003 } } });
    await expect(resolver({ runContext, serverName: 'fake', toolName: 'resolve_product', arguments: { IdItem: 10 } }))
      .resolves.toEqual({ ca: { Execution: { IdCompany: 1003 } } });
    await expect(resolver({ runContext, serverName: 'fake', toolName: 'get_products_pricelists', arguments: {} }))
      .rejects.toThrow('Resolved.IdItem');

    context.Resolved.IdItem = 10;
    await expect(resolver({ runContext, serverName: 'fake', toolName: 'get_products_pricelists', arguments: {} }))
      .resolves.toEqual({ ca: { Execution: { IdCompany: 1003 }, Resolved: { IdItem: 10 } } });
  });

  it('merges Resolved only from MCP metadata and never from product results', async () => {
    const context = makeContext();
    const registry = new McpObservabilityRegistry();
    const tracker = new ToolCallTracker();
    const extractor = createCustomDataExtractor(registry, tracker);
    const runContext = new RunContext(context);

    await extractor({
      runContext,
      serverName: 'fake',
      toolName: 'get_products',
      toolDisplayName: 'get_products',
      arguments: { ItemName: 'carro' },
      resultMeta: undefined,
      structuredContent: { Products: [{ IdItem: 10, ItemName: 'Carro' }] },
      isError: false,
      toolOutput: { Products: [{ IdItem: 10, ItemName: 'Carro' }] },
    });
    expect(context.Resolved).toEqual({});

    await extractor({
      runContext,
      serverName: 'fake',
      toolName: 'resolve_product',
      toolDisplayName: 'resolve_product',
      arguments: { IdItem: 10 },
      resultMeta: { ca: { Resolved: { IdItem: 10 } } },
      structuredContent: { Product: { IdItem: 10 } },
      isError: false,
      toolOutput: { Product: { IdItem: 10 } },
    });
    expect(context.Resolved).toEqual({ IdItem: 10 });
  });

  it('logs MCP before and after events for the product flow', async () => {
    const context = makeContext();
    const repository = new MemoryRepository();
    const logger = new ExecutionLogger(repository, 1);
    const registry = new McpObservabilityRegistry();
    registry.register(context, logger);
    const tracker = new ToolCallTracker();
    const resolver = createToolMetaResolver(registry, tracker);
    const extractor = createCustomDataExtractor(registry, tracker);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    let calls: unknown[][] = [];

    try {
      const runContext = new RunContext(context);
      await resolver({ runContext, serverName: 'fake', toolName: 'resolve_product', arguments: { IdItem: 10 } });
      await extractor({
        runContext,
        serverName: 'fake',
        toolName: 'resolve_product',
        toolDisplayName: 'resolve_product',
        arguments: { IdItem: 10 },
        resultMeta: { ca: { Resolved: { IdItem: 10 } } },
        structuredContent: { Product: { IdItem: 10 } },
        isError: false,
        toolOutput: { Product: { IdItem: 10 } },
      });
      calls = info.mock.calls.map((call) => [...call]);
    } finally {
      info.mockRestore();
    }

    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[0]?.[0]))).toMatchObject({ Event: 'MCP_TOOL_CALL_BEFORE', ToolName: 'resolve_product' });
    expect(JSON.parse(String(calls[1]?.[0]))).toMatchObject({ Event: 'MCP_TOOL_RESULT_AFTER', ToolName: 'resolve_product' });
    expect(repository.logs.map((entry) => entry.data.EventType)).toEqual(['MCP_TOOL_CALL', 'MCP_TOOL_RESULT']);
  });

  it('keeps Flow tool errors model-visible without aborting the whole Turn', async () => {
    const context = makeContext();
    const registry = new McpObservabilityRegistry();
    const tracker = new ToolCallTracker();
    const extractor = createCustomDataExtractor(registry, tracker);
    await expect(extractor({
      runContext: new RunContext(context), serverName: 'fake', toolName: 'execute_flow_action', toolDisplayName: 'execute_flow_action',
      arguments: { Action: 'create_sales_order', Input: {} },
      resultMeta: { ca: { FlowInvocation: { InvocationUUID: 'invocation-uuid' }, Resolved: { IdItem: 999 } } },
      structuredContent: { Success: false, Action: 'create_sales_order', Output: null, Error: { Code: 'FLOW_ACTION_ALREADY_EXECUTED', Message: 'Já executada.' } },
      isError: true,
      toolOutput: JSON.stringify({ Success: false, Error: { Code: 'FLOW_ACTION_ALREADY_EXECUTED', Message: 'Já executada.' } }),
    })).resolves.toBeUndefined();
    expect(context.Resolved).toEqual({});
  });
});
