import { describe, expect, it } from 'vitest';
import { getAllMcpTools, RunContext } from '@openai/agents';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { createCustomDataExtractor } from '../../src/mcp/customDataExtractor.js';
import { createToolMetaResolver } from '../../src/mcp/toolMetaResolver.js';
import { McpObservabilityRegistry, ToolCallTracker } from '../../src/mcp/observability.js';
import { createRuntimeContext } from '../../src/runtime/RuntimeContext.js';
import { createToolFilter } from '../../src/runtime/ToolPolicies.js';

describe('SDK MCP tool policy integration', () => {
  it('re-evaluates pricing availability after resolve_product in one run', async () => {
    const context = createRuntimeContext({
      Agent: 'chat-orchestrator-poc', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789,
      Message: 'Consultar o preço do carro', ExpectedOutput: { Name: 'Intent', Description: 'Identifique.' },
    }, 'uuid');
    const runContext = new RunContext(context);
    const agent = { name: 'SalesAgent' } as any;
    const server = createFakeMcpServer();
    const registry = new McpObservabilityRegistry();
    const tracker = new ToolCallTracker();
    server.toolFilter = createToolFilter() as any;
    server.toolMetaResolver = createToolMetaResolver(registry, tracker) as any;
    server.customDataExtractor = createCustomDataExtractor(registry, tracker) as any;

    const before = await getAllMcpTools({ mcpServers: [server], runContext, agent });
    expect(before.map((tool) => tool.name)).not.toContain('get_products_pricelists');

    const resolveTool = before.find((tool) => tool.name === 'resolve_product') as any;
    expect(resolveTool).toBeDefined();
    const resolveCallId = 'resolve-product-call';
    const resolvedOutput = await resolveTool.invoke(
      runContext,
      JSON.stringify({ IdItem: 10 }),
      { toolCall: { type: 'function_call', callId: resolveCallId, name: 'resolve_product', arguments: '{"IdItem":10}' } as any },
    );
    await resolveTool.customDataExtractor?.({
      runContext,
      tool: resolveTool,
      toolCall: { type: 'function_call', callId: resolveCallId, name: 'resolve_product', arguments: '{"IdItem":10}' } as any,
      input: { IdItem: 10 },
      output: resolvedOutput,
      rawItem: {} as any,
    });
    expect(context.Resolved).toEqual({ IdItem: 10 });

    const after = await getAllMcpTools({ mcpServers: [server], runContext, agent });
    const pricingTool = after.find((tool) => tool.name === 'get_products_pricelists') as any;
    expect(pricingTool).toBeDefined();
    await expect(pricingTool.invoke(runContext, '{}', {
      toolCall: { type: 'function_call', callId: 'pricing-call', name: 'get_products_pricelists', arguments: '{}' } as any,
    })).resolves.toContain('ProductsPriceLists');
  });
});
