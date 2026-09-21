import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { McpObservabilityRegistry } from '../../src/mcp/observability.js';
import { ExecutionLogger } from '../../src/tracing/ExecutionLogger.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { createAIDocumentRuntimeContext } from '../../src/runtime/RuntimeContext.js';
import { RunContext } from '@openai/agents';

function buildRegistry(ids: readonly string[]) {
  return new AgentRegistry(undefined, undefined, { receptionAgentVectorStoreIds: ids });
}

function buildContext() {
  return createAIDocumentRuntimeContext({
    TurnUUID: '14ed24ea-0000-4000-8000-000000000001', Agent: 'reception-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456,
    Messages: [{ IdMessage: 1001, Text: 'Olá' }],
  }, 'execution-uuid', 'session-uuid');
}

describe('ReceptionAgent', () => {
  it('fails clearly when no Vector Store is configured', () => {
    const context = buildContext();
    expect(() => buildRegistry([]).buildAIDocument('reception-agent', {
      mcpServer: createFakeMcpServer(), model: 'test-model', runtimeContext: context,
      logger: new ExecutionLogger(new MemoryRepository(), 1),
    })).toThrow('RECEPTION_AGENT_VECTOR_STORE_IDS');
  });

  it('has file_search and use_flow_capabilities while keeping MCP on FlowAgent', async () => {
    const context = buildContext();
    const graph = buildRegistry(['vs_company', 'vs_policies', 'vs_faq', 'vs_agents']).buildAIDocument('reception-agent', {
      mcpServer: createFakeMcpServer(), model: 'test-model', runtimeContext: context,
      logger: new ExecutionLogger(new MemoryRepository(), 1),
    });
    const tools = await graph.root.getAllTools(new RunContext(context));
    expect(graph.root.name).toBe('ReceptionAgent');
    expect(graph.agents.map((agent) => agent.name)).toEqual(['ReceptionAgent', 'FlowAgent']);
    expect(tools.map((tool) => tool.name)).toEqual(['use_flow_capabilities', 'file_search']);
    expect((await graph.agents[1]!.getAllTools(new RunContext(context))).map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'list_flow_actions', 'describe_flow_action', 'execute_flow_action',
    ]));
  });
});
