import { describe, expect, it } from 'vitest';
import { getAllMcpTools, RunContext } from '@openai/agents';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { createCustomDataExtractor } from '../../src/mcp/customDataExtractor.js';
import { createToolMetaResolver } from '../../src/mcp/toolMetaResolver.js';
import { McpObservabilityRegistry, ToolCallTracker } from '../../src/mcp/observability.js';
import { createRuntimeContext } from '../../src/runtime/RuntimeContext.js';
import { createToolFilter } from '../../src/runtime/ToolPolicies.js';

describe('SDK MCP tool policy integration', () => {
  it('exposes only Flow tools to FlowAgent and no MCP tools to a Root Agent', async () => {
    const context = createRuntimeContext({
      Agent: 'chat-orchestrator-poc', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789,
      Message: 'Consultar o preço do carro', ExpectedOutput: { Name: 'Intent', Description: 'Identifique.' },
    }, 'uuid');
    const runContext = new RunContext(context);
    const agent = { name: 'FlowAgent' } as any;
    const server = createFakeMcpServer();
    const registry = new McpObservabilityRegistry();
    const tracker = new ToolCallTracker();
    server.toolFilter = createToolFilter() as any;
    server.toolMetaResolver = createToolMetaResolver(registry, tracker) as any;
    server.customDataExtractor = createCustomDataExtractor(registry, tracker) as any;

    const flowTools = await getAllMcpTools({ mcpServers: [server], runContext, agent });
    expect(flowTools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['list_flow_actions', 'describe_flow_action', 'execute_flow_action']));
    expect(flowTools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining([
      'get_chat_history', 'get_process_line_flow_state', 'get_products', 'get_pricelists', 'resolve_product', 'get_products_pricelists',
    ]));

    const rootTools = await getAllMcpTools({ mcpServers: [server], runContext, agent: { name: 'SalesAgent' } as any });
    expect(rootTools).toHaveLength(0);
  });
});
