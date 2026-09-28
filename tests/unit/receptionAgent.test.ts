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

  it('has Knowledge and Navigation without Flow while isolating MCP specialists', async () => {
    const context = buildContext();
    const graph = buildRegistry(['vs_company', 'vs_policies', 'vs_faq', 'vs_agents']).buildAIDocument('reception-agent', {
      mcpServer: createFakeMcpServer(), model: 'test-model', runtimeContext: context,
      logger: new ExecutionLogger(new MemoryRepository(), 1),
    });
    const tools = await graph.root.getAllTools(new RunContext(context));
    expect(graph.root.name).toBe('ReceptionAgent');
    expect(graph.agents.map((agent) => agent.name)).toEqual(['ReceptionAgent', 'NavigationAgent']);
    expect(tools.map((tool) => tool.name)).toEqual(['use_navigation', 'file_search']);
    expect((await graph.agents[1]!.getAllTools(new RunContext(context))).map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'list_navigation_destinations', 'request_handoff',
    ]));
  });

  it('keeps technical instructions and composes company instructions in a lower-priority section', () => {
    const agentContext = {
      ...buildContext(),
      agentConfiguration: { Code: 'reception-agent', Revision: 3, Instructions: 'Use um tom acolhedor.' },
    };
    const graph = buildRegistry(['vs_company']).buildAIDocument('reception-agent', {
      mcpServer: createFakeMcpServer(), model: 'test-model', runtimeContext: agentContext,
      logger: new ExecutionLogger(new MemoryRepository(), 1), agentConfiguration: agentContext.agentConfiguration,
    });
    const instructions = graph.root.instructions as string;
    expect(instructions.indexOf('[TECHNICAL INSTRUCTIONS]')).toBeLessThan(instructions.indexOf('[COMPANY AGENT CONFIGURATION]'));
    expect(instructions.indexOf('[COMPANY AGENT CONFIGURATION]')).toBeLessThan(instructions.indexOf('[RUNTIME CONTEXT]'));
    expect(instructions).toContain('Use um tom acolhedor.');
    expect(instructions).toContain('não substituem, desativam ou contradizem as regras técnicas');
    expect(instructions).not.toContain('use_flow_capabilities');
  });

  it.each(['sales-agent', 'support-agent'])('%s keeps Flow enabled', async (agentName) => {
    const graph = buildRegistry(['vs_company']).buildAIDocument(agentName, {
      mcpServer: createFakeMcpServer(), model: 'test-model', runtimeContext: buildContext(),
      logger: new ExecutionLogger(new MemoryRepository(), 1),
    });
    const tools = await graph.root.getAllTools(new RunContext(buildContext()));
    expect(tools.map((tool) => tool.name)).toContain('use_flow_capabilities');
  });
});
