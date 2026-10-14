import { describe, expect, it } from 'vitest';
import { getAllMcpTools, RunContext } from '@openai/agents';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { McpObservabilityRegistry } from '../../src/mcp/observability.js';
import { ExecutionLogger } from '../../src/tracing/ExecutionLogger.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { createAIDocumentRuntimeContext } from '../../src/runtime/RuntimeContext.js';

describe('Agent Platform specialist tool boundaries', () => {
  it('exposes local Flow and Navigation capabilities while isolating both MCP specialists', async () => {
    const context = createAIDocumentRuntimeContext({
      CompanyUUID: '14ed24ea-0000-4000-8000-000000000001',
      TurnUUID: '14ed24ea-0000-4000-8000-000000000001', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456,
      Messages: [{ IdMessage: 1001, Text: 'Execute a tarefa' }],
    }, 'execution-uuid', 'session-uuid', { CompanyUUID: '14ed24ea-0000-4000-8000-000000000001', IdDatabase: 8, IdCompany: 1003 });
    const repository = new MemoryRepository();
    const logger = new ExecutionLogger(repository, 1);
    const server = createFakeMcpServer();
    const graph = new AgentRegistry().buildAIDocument('sales-agent', { mcpServer: server, model: 'test-model', runtimeContext: context, logger });
    const runContext = new RunContext(context);
    const rootTools = await graph.root.getAllTools(runContext);
    const flowTools = await graph.agents[1]!.getAllTools(runContext);

    expect(rootTools.map((tool) => tool.name)).toEqual(['use_flow_capabilities', 'use_navigation']);
    expect(rootTools.map((tool) => tool.name)).not.toContain('list_flow_actions');
    expect(rootTools.map((tool) => tool.name)).not.toContain('describe_flow_action');
    expect(rootTools.map((tool) => tool.name)).not.toContain('execute_flow_action');
    expect(flowTools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['list_flow_actions', 'describe_flow_action', 'execute_flow_action']));
    expect(flowTools.map((tool) => tool.name)).not.toContain('get_products');
    const navigationTools = await graph.agents[2]!.getAllTools(runContext);
    expect(navigationTools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['list_navigation_destinations', 'request_handoff']));
    expect(navigationTools.map((tool) => tool.name)).not.toContain('list_flow_actions');
  });

  it('gives Support and Reception the local Navigation capability without direct MCP access', async () => {
    const context = createAIDocumentRuntimeContext({
      CompanyUUID: '14ed24ea-0000-4000-8000-000000000001',
      TurnUUID: '14ed24ea-0000-4000-8000-000000000002', Agent: 'support-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 457,
      Messages: [{ IdMessage: 1002, Text: 'Preciso de suporte' }],
    }, 'execution-uuid-2', 'session-uuid-2', { CompanyUUID: '14ed24ea-0000-4000-8000-000000000001', IdDatabase: 8, IdCompany: 1003 });
    const repository = new MemoryRepository();
    const logger = new ExecutionLogger(repository, 1);
    const server = createFakeMcpServer();
    const registry = new AgentRegistry();

    const support = registry.buildAIDocument('support-agent', { mcpServer: server, model: 'test-model', runtimeContext: context, logger });
    const reception = registry.buildAIDocument('reception-agent', { mcpServer: server, model: 'test-model', runtimeContext: context, logger });
    const runContext = new RunContext(context);

    expect((await support.root.getAllTools(runContext)).map((tool) => tool.name)).toEqual(['use_flow_capabilities', 'use_navigation']);
    expect((await reception.root.getAllTools(runContext)).map((tool) => tool.name)).toEqual(['use_navigation']);
    expect(reception.agents.map((agent) => agent.name)).toEqual(['ReceptionAgent', 'NavigationAgent']);
    expect((await reception.agents[1]!.getAllTools(runContext)).map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'list_navigation_destinations', 'request_handoff',
    ]));
  });
});
