import { describe, expect, it } from 'vitest';
import { getAllMcpTools, RunContext } from '@openai/agents';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { McpObservabilityRegistry } from '../../src/mcp/observability.js';
import { ExecutionLogger } from '../../src/tracing/ExecutionLogger.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { createAIDocumentRuntimeContext } from '../../src/runtime/RuntimeContext.js';

describe('AIDocument FlowAgent tool boundary', () => {
  it('exposes use_flow_capabilities to roots while exposing Flow tools only to FlowAgent', async () => {
    const context = createAIDocumentRuntimeContext({
      TurnUUID: '14ed24ea-0000-4000-8000-000000000001', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456,
      Messages: [{ IdMessage: 1001, Text: 'Execute a tarefa' }],
    }, 'execution-uuid', 'session-uuid');
    const repository = new MemoryRepository();
    const logger = new ExecutionLogger(repository, 1);
    const server = createFakeMcpServer();
    const graph = new AgentRegistry().buildAIDocument('sales-agent', { mcpServer: server, model: 'test-model', runtimeContext: context, logger });
    const runContext = new RunContext(context);
    const rootTools = await graph.root.getAllTools(runContext);
    const flowTools = await graph.agents[1]!.getAllTools(runContext);

    expect(rootTools.map((tool) => tool.name)).toContain('use_flow_capabilities');
    expect(rootTools.map((tool) => tool.name)).not.toContain('list_flow_actions');
    expect(rootTools.map((tool) => tool.name)).not.toContain('describe_flow_action');
    expect(rootTools.map((tool) => tool.name)).not.toContain('execute_flow_action');
    expect(flowTools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['list_flow_actions', 'describe_flow_action', 'execute_flow_action']));
    expect(flowTools.map((tool) => tool.name)).not.toContain('get_products');
  });
});
