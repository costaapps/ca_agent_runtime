import { describe, expect, it, vi } from 'vitest';
import { Agent, Runner, Usage, type AgentInputItem, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { createSalesAgent } from '../../src/agents/aidocument/roots/salesAgent.js';
import { KnowledgeConfigurationSchema } from '../../src/api/contracts/knowledgeConfiguration.js';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import { KnowledgeSearchService } from '../../src/knowledge/KnowledgeSearchService.js';
import { EnvironmentProviderCredentialResolver } from '../../src/knowledge/credentials/EnvironmentProviderCredentialResolver.js';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { McpObservabilityRegistry } from '../../src/mcp/observability.js';
import type { RuntimeContextData } from '../../src/runtime/RuntimeContext.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { MemorySessionRepository } from '../helpers/memorySessionRepository.js';
import { configuredKnowledge } from '../helpers/knowledgeConfiguration.js';

class KnowledgeModel implements Model {
  requests: ModelRequest[] = [];
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const existing = (request.input as AgentInputItem[]).find((item) => item.type === 'function_call_result' && item.name === 'search_knowledge') as any;
    const output = existing
      ? [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ Response: 'O prazo é de 14 dias.', Control: { CompletionRequested: false, Reason: null, ContextUpdates: [] } }) }] }]
      : [{ type: 'function_call', name: 'search_knowledge', callId: 'knowledge-search-1', arguments: JSON.stringify({ Reference: 'document:commercial/refund-policy', Query: 'Qual é o prazo?' }) }];
    return { usage: new Usage({ requests: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 }), output: output as any };
  }
  getStreamedResponse(): AsyncIterable<any> { throw new Error('stream não utilizado'); }
}

describe('Knowledge through the real Agents SDK with a fake model', () => {
  it('executes local search_knowledge, not MCP, and returns normalized evidence to the Root', async () => {
    const model = new KnowledgeModel();
    const search = vi.fn().mockResolvedValue([{ SourceName: 'politica.pdf', Content: 'O prazo é de 14 dias.' }]);
    const repository = new MemoryRepository();
    const sessions = new MemorySessionRepository(repository);
    const runtime = new AgentRuntime({
      repository, sessionRepository: sessions, registry: new AgentRegistry(undefined, { 'sales-agent': (context) => createSalesAgent({ ...context, model: model as any }) }),
      runner: { async run(agent: Agent<RuntimeContextData, any>, input: string | AgentInputItem[], context: RuntimeContextData, _trace: any, session?: any) {
        const runner = new Runner({ model, tracingDisabled: true, workflowName: 'knowledge-test' });
        const result = await runner.run(agent, input, { context, stream: false, session });
        return { finalOutput: result.finalOutput, lastAgent: result.lastAgent ? { name: result.lastAgent.name } : undefined };
      } },
      mcpServer: createFakeMcpServer(), observability: new McpObservabilityRegistry(), model: 'test-model', tracingEnabled: false, traceIncludeSensitiveData: false,
      knowledgeSearchService: new KnowledgeSearchService({ search }, new EnvironmentProviderCredentialResolver({ OPENAI_API_KEY: 'secret-key' })),
    });
    const turn = await runtime.runTurn({
      TurnUUID: '14ed24ea-0000-4000-8000-000000000610', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456,
      Messages: [{ IdMessage: 610, Text: 'Posso pedir reembolso?' }],
      AgentConfiguration: { Code: 'sales-agent', Revision: 1, Instructions: 'Consulte {{knowledge:document:commercial/refund-policy}} para reembolso.' },
      KnowledgeConfiguration: KnowledgeConfigurationSchema.parse(configuredKnowledge),
    });
    expect(turn.statusCode, JSON.stringify({ turn, logs: repository.logs.map((entry) => ({ EventType: entry.data.EventType, ErrorMessage: entry.data.ErrorMessage })) })).toBe(200);
    expect(turn).toMatchObject({ statusCode: 200, response: { Success: true, Response: 'O prazo é de 14 dias.' } });
    expect(search).toHaveBeenCalledTimes(1);
    expect(model.requests[0]!.tools.map((entry) => entry.name)).toContain('search_knowledge');
    const toolResult = (model.requests[1]!.input as AgentInputItem[]).find((item) => item.type === 'function_call_result' && item.name === 'search_knowledge') as any;
    expect(JSON.parse(toolResult.output.text)).toMatchObject({ Status: 'FOUND', Results: [{ SourceName: 'politica.pdf', Content: 'O prazo é de 14 dias.' }] });
    expect(JSON.stringify(toolResult)).not.toMatch(/secret-key|vs_secret|file_secret|score/);
    expect(repository.logs.some((entry) => entry.data.EventType === 'KNOWLEDGE_SEARCH')).toBe(true);
    expect(repository.logs.some((entry) => entry.data.EventType === 'MCP_TOOL_CALL')).toBe(false);
  });
});
