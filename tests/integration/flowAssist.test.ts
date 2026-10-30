import { describe, expect, it, vi } from 'vitest';
import { Runner, Usage, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { createApp } from '../../src/app.js';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { createFlowAssistAgent, flowAssistInputItems } from '../../src/agents/flow-assist/flowAssistAgent.js';
import { FlowAssistOutputSchema } from '../../src/api/contracts/flowAssistOutput.js';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import { isToolAvailable, ToolPolicies } from '../../src/runtime/ToolPolicies.js';
import { McpObservabilityRegistry } from '../../src/mcp/observability.js';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { MemorySessionRepository } from '../helpers/memorySessionRepository.js';
import { flowAssistInput, flowAssistOutput } from '../helpers/flowAssist.js';
import { flowAssistCheckInput, flowAssistV2Input } from '../helpers/flowAssist.js';
import { configuredKnowledge } from '../helpers/knowledgeConfiguration.js';
import { KnowledgeConfigurationSchema } from '../../src/api/contracts/knowledgeConfiguration.js';
import { KnowledgeSearchService } from '../../src/knowledge/KnowledgeSearchService.js';
import { EnvironmentProviderCredentialResolver } from '../../src/knowledge/credentials/EnvironmentProviderCredentialResolver.js';
import type { KnowledgeSearchProvider } from '../../src/knowledge/providers/KnowledgeSearchProvider.js';

class AssistModel implements Model {
  requests: ModelRequest[] = [];
  constructor(private readonly output: unknown = flowAssistOutput, private readonly error?: Error) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    if (this.error) throw this.error;
    // These decisions are scripted: this test proves SDK protocol, not actual
    // linguistic interpretation. The explicit live tests below cover semantics.
    expect(request.tools).toEqual([]);
    expect(request.handoffs).toEqual([]);
    expect(request.outputType).toMatchObject({ type: 'json_schema', strict: true, schema: { type: 'object', additionalProperties: false } });
    expect(request.systemInstructions).toContain('ObjectDescription define');
    return {
      usage: new Usage({ requests: 1 }),
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(this.output) }] }],
    };
  }

  getStreamedResponse(): AsyncIterable<never> { throw new Error('stream não utilizado'); }
}

class CheckKnowledgeModel implements Model {
  requests: ModelRequest[] = [];
  constructor(private readonly reference = 'base:commercial') {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    expect(request.handoffs).toEqual([]);
    expect(request.tools.map((entry) => entry.name)).toEqual(['search_knowledge']);
    expect(request.outputType).toMatchObject({ type: 'json_schema', strict: true });
    const previous = (request.input as { type?: string; name?: string; output?: { text?: string } }[])
      .find((item) => item.type === 'function_call_result' && item.name === 'search_knowledge');
    const output = previous
      ? [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({
        Mode: 'CHECK', Results: [
          { IdProcessLineFlow: 81231, Action: 'KEEP', Value: null, Reason: null },
          { IdProcessLineFlow: 81232, Action: previous.output?.text?.includes('NO_RESULTS') ? 'INVALID' : 'REPLACE', Value: previous.output?.text?.includes('NO_RESULTS') ? null : 'Jadlog', Reason: previous.output?.text?.includes('NO_RESULTS') ? 'Política não encontrada.' : null },
        ],
      }) }] }]
      : [{ type: 'function_call', name: 'search_knowledge', callId: 'check-search-1', arguments: JSON.stringify({ Reference: this.reference, Query: 'Transportadora permitida?' }) }];
    return { usage: new Usage({ requests: 1 }), output: output as ModelResponse['output'] };
  }
  getStreamedResponse(): AsyncIterable<never> { throw new Error('stream não utilizado'); }
}

class PrefillKnowledgeModel implements Model {
  requests: ModelRequest[] = [];
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    expect(request.tools.map((entry) => entry.name)).toEqual(['search_knowledge']);
    expect(request.handoffs).toEqual([]);
    expect(request.outputType).toMatchObject({ type: 'json_schema', strict: true });
    expect(request.systemInstructions).toContain('somente search_knowledge');
    const previous = (request.input as { type?: string; name?: string; output?: { text?: string } }[])
      .find((item) => item.type === 'function_call_result' && item.name === 'search_knowledge');
    const result = previous ? JSON.parse(previous.output!.text!) as { Status: string; Results: { Content: string }[] } : undefined;
    const output = result
      ? [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ Proposals: [{ IdProcessLineFlow: 81231, Status: result.Status === 'FOUND' ? 'PROPOSED' : 'UNKNOWN', Value: result.Status === 'FOUND' ? 'Jadlog' : null }] }) }] }]
      : [{ type: 'function_call', name: 'search_knowledge', callId: 'prefill-search-1', arguments: JSON.stringify({ Reference: 'base:commercial', Query: 'Transportadora permitida?' }) }];
    return { usage: new Usage({ requests: 1 }), output: output as ModelResponse['output'] };
  }
  getStreamedResponse(): AsyncIterable<never> { throw new Error('stream não utilizado'); }
}

class CheckWithoutKnowledgeModel implements Model {
  requests: ModelRequest[] = [];
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    expect(request.tools).toEqual([]);
    expect(request.handoffs).toEqual([]);
    expect(request.outputType).toMatchObject({ type: 'json_schema', strict: true });
    return { usage: new Usage({ requests: 1 }), output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ Mode: 'CHECK', Results: [{ IdProcessLineFlow: 81231, Action: 'KEEP', Value: null, Reason: null }] }) }] }] };
  }
  getStreamedResponse(): AsyncIterable<never> { throw new Error('stream não utilizado'); }
}

function setup(model: Model & { requests: ModelRequest[] } = new AssistModel(), knowledgeSearchService?: KnowledgeSearchService) {
  const repository = new MemoryRepository();
  const sessions = new MemorySessionRepository(repository);
  const createSession = vi.spyOn(sessions, 'createSession');
  const findSession = vi.spyOn(sessions, 'findByProcessLine');
  const mcp = createFakeMcpServer();
  const listTools = vi.spyOn(mcp, 'listTools').mockRejectedValue(new Error('MCP must not be used'));
  const callTool = vi.spyOn(mcp, 'callTool').mockRejectedValue(new Error('MCP must not be used'));
  const run = vi.fn(async (...args: Parameters<import('../../src/openai/runner.js').OpenAIRunner['run']>) => {
    const [agent, input, context, _tracing, session] = args;
    expect(session).toBeUndefined();
    expect(agent.mcpServers).toEqual([]);
    for (const name of Object.keys(ToolPolicies)) expect(isToolAvailable(name, agent.name, context)).toBe(false);
    // An explicit Agent.model takes precedence over Runner.model. Replace only
    // the provider in the test clone, keeping the real instructions/schema.
    return new Runner({ model, tracingDisabled: true }).run(agent.clone({ model }), input, { context });
  });
  const runtime = new AgentRuntime({ repository, sessionRepository: sessions, registry: new AgentRegistry(), runner: { run }, mcpServer: mcp, observability: new McpObservabilityRegistry(), model: 'test-model', tracingEnabled: false, traceIncludeSensitiveData: false, knowledgeSearchService });
  return { model, repository, sessions, createSession, findSession, listTools, callTool, run, runtime };
}

async function withServer(runtime: AgentRuntime, test: (post: (payload: unknown) => Promise<Response>) => Promise<void>) {
  const server = createApp(runtime).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing HTTP address');
  try {
    await test((payload) => fetch(`http://127.0.0.1:${address.port}/v1/flow-assist`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe('HTTP -> controller -> runtime -> tool-free Agent with real SDK Runner', () => {
  it('returns four semantic proposals and persists the AGENTASSIST execution without Session/MCP', async () => {
    const state = setup();
    await withServer(state.runtime, async (post) => {
      const response = await post(flowAssistInput);
      expect(response.status, JSON.stringify(state.repository.executions[0]?.final)).toBe(200);
      const body = FlowAssistOutputSchema.parse(await response.json());
      expect(body).toMatchObject({ Success: true, ...flowAssistOutput });
      expect(body).not.toHaveProperty('SessionUUID');
      expect(body).not.toHaveProperty('Response');
      expect(body).not.toHaveProperty('Control');
    });
    expect(state.model.requests).toHaveLength(1);
    const request = state.model.requests[0]!;
    expect(request.input).toEqual(flowAssistInputItems(flowAssistInput));
    expect(state.repository.executions[0]?.data.IdProcessLineFlow).toBe(789);
    expect(state.repository.executions[0]?.final?.Success).toBe('Y');
    expect(state.sessions.sessions).toEqual([]);
    expect(state.createSession).not.toHaveBeenCalled();
    expect(state.findSession).not.toHaveBeenCalled();
    expect(state.listTools).not.toHaveBeenCalled();
    expect(state.callTool).not.toHaveBeenCalled();
  });

  it('accepts protocol v2, validates continuation proposals and persists the versioned contract', async () => {
    const v2Output = { ...flowAssistOutput, NextAgentAssists: [] };
    const state = setup(new AssistModel(v2Output));
    await withServer(state.runtime, async (post) => {
      const response = await post(flowAssistV2Input);
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(FlowAssistOutputSchema.parse(body)).toMatchObject({ Success: true, ProtocolVersion: 2, ...v2Output });
    });
    expect(state.model.requests).toHaveLength(1);
    expect(state.model.requests[0]?.systemInstructions).toContain('StepManifest');
    expect(JSON.parse(state.repository.executions[0]!.data.RuntimeConfigJSON!)).toMatchObject({ ProtocolVersion: 2 });
  });

  it('rejects an incoherent manifest at HTTP boundary before persistence or inference', async () => {
    const state = setup();
    await withServer(state.runtime, async (post) => {
      for (const payload of [{}, { ...flowAssistInput, Targets: [flowAssistInput.Targets[0], flowAssistInput.Targets[0]] }, { ...flowAssistInput, Targets: [{ ...flowAssistInput.Targets[0], Query: 'SELECT *' }] }]) {
        const response = await post(payload);
        expect(response.status).toBe(400);
        expect(FlowAssistOutputSchema.parse(await response.json())).toMatchObject({ Success: false, Proposals: [], Error: { Code: 'INVALID_REQUEST' } });
      }
    });
    expect(state.repository.executions).toEqual([]);
    expect(state.run).not.toHaveBeenCalled();
  });

  it('returns UNKNOWN for every target when the scripted model has no evidence', async () => {
    const output = { Proposals: flowAssistInput.Targets.map((target) => ({ IdProcessLineFlow: target.IdProcessLineFlow, Status: 'UNKNOWN', Value: null })) };
    const state = setup(new AssistModel(output));
    await withServer(state.runtime, async (post) => {
      const response = await post({ ...flowAssistInput, Messages: [], Known: [] });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ Success: true, ...output });
    });
    expect(state.model.requests).toHaveLength(1);
    expect(state.repository.executions[0]?.final?.Success).toBe('Y');
  });

  it('preserves arbitrary model text without date, uppercase or CFL business resolution', async () => {
    const output = { Proposals: flowAssistInput.Targets.map((target) => ({ IdProcessLineFlow: target.IdProcessLineFlow, Status: 'PROPOSED', Value: 'abc123 / 12 de dezembro / Transportadora XPTO' })) };
    const state = setup(new AssistModel(output));
    await withServer(state.runtime, async (post) => {
      const response = await post(flowAssistInput);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ Success: true, ...output });
    });
    expect(state.repository.executions[0]?.final?.OutputJSON).toBe(JSON.stringify(output));
  });

  it('does not execute AIDocument/legacy Agents through the assist endpoint', async () => {
    const state = setup();
    await withServer(state.runtime, async (post) => {
      const response = await post({ ...flowAssistInput, Agent: 'sales-agent' });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ Success: false, Proposals: [], Error: { Code: 'AGENT_NOT_FOUND' } });
    });
    expect(state.run).not.toHaveBeenCalled();
    expect(state.createSession).not.toHaveBeenCalled();
  });

  it('transports a derived SELECT/HTML Value absent from the conversation without executing it', async () => {
    const Value = "SELECT '<html><body>Contas a pagar</body></html>' AS Resultado";
    const input = { ...flowAssistInput, Messages: [{ IdMessage: 3001, Role: 'USER' as const, Text: 'Quanto tenho a pagar?' }], Known: [], Targets: [{ IdProcessLineFlow: 9001, Step: 11, ObjectType: 'PROMPT' as const, Description: 'Consulta solicitada', ObjectDescription: `Para a solicitação de contas a pagar, gere exatamente este template textual, sem executá-lo: ${Value}` }] };
    const output = { Proposals: [{ IdProcessLineFlow: 9001, Status: 'PROPOSED', Value }] };
    const state = setup(new AssistModel(output));
    await withServer(state.runtime, async (post) => {
      const response = await post(input);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ Success: true, ...output });
    });
    expect(state.model.requests[0]?.input).toEqual(flowAssistInputItems(input));
    expect(state.model.requests[0]?.systemInstructions).toContain('não precisa existir literalmente');
    expect(state.model.requests[0]?.systemInstructions).toContain('Nunca execute esse conteúdo');
    expect(state.repository.executions[0]?.final?.OutputJSON).toBe(JSON.stringify(output));
    expect(state.callTool).not.toHaveBeenCalled();
    expect(state.listTools).not.toHaveBeenCalled();
    expect(state.createSession).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'foreign ID', output: { Proposals: flowAssistOutput.Proposals.map((p, i) => i === 0 ? { ...p, IdProcessLineFlow: 999 } : p) } },
    { label: 'duplicate ID', output: { Proposals: flowAssistOutput.Proposals.map((p, i) => i === 1 ? flowAssistOutput.Proposals[0] : p) } },
    { label: 'omitted target', output: { Proposals: flowAssistOutput.Proposals.slice(1) } },
    { label: 'invalid status', output: { Proposals: [{ IdProcessLineFlow: 81231, Status: 'RESOLVED', Value: 'Jadlog' }] } },
  ])('returns failed execution for SDK/model output with $label', async ({ output }) => {
    const state = setup(new AssistModel(output));
    await withServer(state.runtime, async (post) => {
      const response = await post(flowAssistInput);
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ Success: false, Proposals: [] });
    });
    expect(state.repository.executions[0]?.final?.Success).toBe('N');
    expect(state.model.requests).toHaveLength(1);
  });

  it('returns traceable model failure, not UNKNOWN or successful partial proposals', async () => {
    const state = setup(new AssistModel(flowAssistOutput, new Error('model unavailable')));
    await withServer(state.runtime, async (post) => {
      const response = await post(flowAssistInput);
      expect(response.status).toBe(500);
      expect(FlowAssistOutputSchema.parse(await response.json())).toMatchObject({ Success: false, Proposals: [], Error: { Code: 'AGENT_EXECUTION_ERROR' } });
    });
    expect(state.repository.executions[0]?.final?.ErrorCode).toBe('AGENT_EXECUTION_ERROR');
    expect(state.model.requests).toHaveLength(1);
  });

  it.each(['', '   '])('maps SDK rejection of blank PROPOSED Value %j to INVALID_AGENT_OUTPUT', async (Value) => {
    const output = { Proposals: flowAssistOutput.Proposals.map((proposal, index) => index === 0 ? { ...proposal, Value } : proposal) };
    const state = setup(new AssistModel(output));
    const finish = vi.spyOn(state.repository, 'finishExecution');
    await withServer(state.runtime, async (post) => {
      const response = await post(flowAssistInput);
      expect(response.status).toBe(500);
      expect(FlowAssistOutputSchema.parse(await response.json())).toMatchObject({ Success: false, Proposals: [], Error: { Code: 'INVALID_AGENT_OUTPUT' } });
    });
    expect(state.model.requests).toHaveLength(1);
    expect(finish).not.toHaveBeenCalled();
    expect(state.repository.executions[0]?.final).toMatchObject({ Success: 'N', ErrorCode: 'INVALID_AGENT_OUTPUT' });
    expect(state.repository.logs.some(({ data }) => data.EventType === 'AGENT_OUTPUT')).toBe(false);
  });
});

describe('CHECK + native Knowledge through HTTP and the real SDK Runner', () => {
  const configuration = KnowledgeConfigurationSchema.parse(configuredKnowledge);
  const checkInput = { ...flowAssistCheckInput, KnowledgeConfiguration: configuration, Targets: flowAssistCheckInput.Targets.slice(0, 2) };
  const knowledgeService = (search: KnowledgeSearchProvider['search']) => new KnowledgeSearchService({ search }, new EnvironmentProviderCredentialResolver({ OPENAI_API_KEY: 'test-key' }));

  it('calls authorized search_knowledge and returns KEEP/REPLACE without MCP or Session', async () => {
    const search = vi.fn().mockResolvedValue([{ SourceName: 'politica.pdf', Content: 'Jadlog é permitida.' }]);
    const state = setup(new CheckKnowledgeModel(), knowledgeService(search));
    await withServer(state.runtime, async (post) => {
      const response = await post(checkInput);
      expect(response.status, JSON.stringify(state.repository.executions[0]?.final)).toBe(200);
      expect(FlowAssistOutputSchema.parse(await response.json())).toMatchObject({ Success: true, Mode: 'CHECK', Results: [
        { Action: 'KEEP', Value: null }, { Action: 'REPLACE', Value: 'Jadlog' },
      ] });
    });
    expect(search).toHaveBeenCalledOnce();
    expect(state.model.requests).toHaveLength(2);
    expect(state.model.requests[0]?.input).toEqual(flowAssistInputItems(checkInput));
    const toolResult = (state.model.requests[1]?.input as { type?: string; name?: string; output?: { text?: string } }[])
      .find((item) => item.type === 'function_call_result' && item.name === 'search_knowledge');
    expect(JSON.parse(toolResult!.output!.text!)).toMatchObject({ Status: 'FOUND', Results: [{ Content: 'Jadlog é permitida.' }] });
    expect(JSON.stringify(toolResult)).not.toMatch(/test-key|vs_secret|file_secret/);
    expect(state.repository.logs.map((entry) => entry.data.EventType)).toContain('KNOWLEDGE_SEARCH');
    expect(state.repository.executions[0]?.final).toMatchObject({ Success: 'Y' });
    expect(JSON.parse(state.repository.executions[0]!.data.RuntimeConfigJSON!)).toMatchObject({ Mode: 'FLOW_ASSIST', AssistMode: 'CHECK' });
    expect(state.sessions.sessions).toEqual([]);
    expect(state.createSession).not.toHaveBeenCalled();
    expect(state.findSession).not.toHaveBeenCalled();
    expect(state.callTool).not.toHaveBeenCalled();
    expect(state.listTools).not.toHaveBeenCalled();
  });

  it('runs CHECK without Knowledge references with no tools and no Session', async () => {
    const state = setup(new CheckWithoutKnowledgeModel());
    await withServer(state.runtime, async (post) => {
      const response = await post({ ...flowAssistCheckInput, Instructions: '', Targets: [flowAssistCheckInput.Targets[0]], KnowledgeConfiguration: { Version: 1, Connections: [], References: [] } });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ Success: true, Mode: 'CHECK', Results: [{ Action: 'KEEP' }] });
    });
    expect(state.model.requests).toHaveLength(1);
    expect(state.sessions.sessions).toEqual([]);
    expect(state.callTool).not.toHaveBeenCalled();
  });

  it('searches an authorized document using its configured filter', async () => {
    const search = vi.fn().mockResolvedValue([{ SourceName: 'refund-policy.pdf', Content: 'Jadlog é permitida.' }]);
    const state = setup(new CheckKnowledgeModel('document:commercial/refund-policy'), knowledgeService(search));
    await withServer(state.runtime, async (post) => {
      const response = await post({ ...checkInput, Instructions: 'Confira conforme {{knowledge:document:commercial/refund-policy}}.' });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ Success: true, Mode: 'CHECK' });
    });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ filter: { type: 'eq', key: 'ca_document_code', value: 'refund-policy' } }));
    expect(state.callTool).not.toHaveBeenCalled();
  });

  it('does not invent a compliant value from NO_RESULTS', async () => {
    const state = setup(new CheckKnowledgeModel(), knowledgeService(vi.fn().mockResolvedValue([])));
    await withServer(state.runtime, async (post) => {
      const response = await post(checkInput);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ Success: true, Mode: 'CHECK', Results: [{ Action: 'KEEP' }, { Action: 'INVALID', Value: null }] });
    });
    expect(state.repository.logs.find((entry) => entry.data.EventType === 'KNOWLEDGE_SEARCH')?.data.Status).toBe('NO_RESULTS');
  });

  it('fails the execution on provider errors without returning fabricated results', async () => {
    const state = setup(new CheckKnowledgeModel(), knowledgeService(vi.fn().mockRejectedValue(new Error('provider secret'))));
    await withServer(state.runtime, async (post) => {
      const response = await post(checkInput);
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ Success: false, Mode: 'CHECK', Results: [] });
    });
    expect(state.repository.executions[0]?.final).toMatchObject({ Success: 'N' });
    expect(state.repository.logs.find((entry) => entry.data.EventType === 'KNOWLEDGE_SEARCH')?.data.Status).toBe('ERROR');
  });

  it('rejects an unauthorized Knowledge macro before persistence', async () => {
    const state = setup(new CheckKnowledgeModel(), knowledgeService(vi.fn()));
    await withServer(state.runtime, async (post) => {
      const response = await post({ ...checkInput, Instructions: 'Use {{knowledge:base:foreign}}.' });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ Success: false, Mode: 'CHECK', Results: [], Error: { Code: 'INVALID_REQUEST' } });
    });
    expect(state.repository.executions).toEqual([]);
    expect(state.run).not.toHaveBeenCalled();
  });

  it('rejects a model call to a Reference absent from the authorized snapshot', async () => {
    const search = vi.fn();
    const state = setup(new CheckKnowledgeModel('base:foreign'), knowledgeService(search));
    await withServer(state.runtime, async (post) => {
      const response = await post(checkInput);
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ Success: false, Mode: 'CHECK', Results: [] });
    });
    expect(search).not.toHaveBeenCalled();
    expect(state.repository.executions[0]?.final).toMatchObject({ Success: 'N' });
  });
});

describe('PREFILL + native Knowledge through HTTP and the real SDK Runner', () => {
  const configuration = KnowledgeConfigurationSchema.parse(configuredKnowledge);
  const input = { ...flowAssistInput, Instructions: 'Identifique a transportadora conforme {{knowledge:base:commercial}}.', Targets: [flowAssistInput.Targets[0]!], KnowledgeConfiguration: configuration };
  const knowledgeService = (search: KnowledgeSearchProvider['search']) => new KnowledgeSearchService({ search }, new EnvironmentProviderCredentialResolver({ OPENAI_API_KEY: 'test-key' }));

  it.each([undefined, 'PREFILL' as const])('accepts Mode=%s, searches Knowledge, and preserves the PREFILL response', async (Mode) => {
    const search = vi.fn().mockResolvedValue([{ SourceName: 'politica.pdf', Content: 'Jadlog é permitida.' }]);
    const state = setup(new PrefillKnowledgeModel(), knowledgeService(search));
    await withServer(state.runtime, async (post) => {
      const response = await post({ ...input, ...(Mode ? { Mode } : {}) });
      expect(response.status, JSON.stringify(state.repository.executions[0]?.final)).toBe(200);
      expect(FlowAssistOutputSchema.parse(await response.json())).toMatchObject({ Success: true, Proposals: [{ Status: 'PROPOSED', Value: 'Jadlog' }] });
    });
    expect(search).toHaveBeenCalledOnce();
    expect(state.model.requests).toHaveLength(2);
    expect(JSON.stringify(state.model.requests[0]?.input)).not.toMatch(/vs_secret|file_secret|test-key/);
    expect(state.repository.logs.find((entry) => entry.data.EventType === 'KNOWLEDGE_SEARCH')?.data.Status).toBe('FOUND');
    expect(state.sessions.sessions).toEqual([]);
    expect(state.callTool).not.toHaveBeenCalled();
    expect(state.listTools).not.toHaveBeenCalled();
  });

  it('returns UNKNOWN after NO_RESULTS without fabricating a proposal', async () => {
    const state = setup(new PrefillKnowledgeModel(), knowledgeService(vi.fn().mockResolvedValue([])));
    await withServer(state.runtime, async (post) => {
      const response = await post(input);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ Success: true, Proposals: [{ Status: 'UNKNOWN', Value: null }] });
    });
    expect(state.repository.logs.find((entry) => entry.data.EventType === 'KNOWLEDGE_SEARCH')?.data.Status).toBe('NO_RESULTS');
  });

  it('rejects a PREFILL macro absent from KnowledgeConfiguration before execution', async () => {
    const state = setup(new PrefillKnowledgeModel(), knowledgeService(vi.fn()));
    await withServer(state.runtime, async (post) => {
      const response = await post({ ...input, Instructions: 'Consulte {{knowledge:base:foreign}}.' });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ Success: false, Proposals: [], Error: { Code: 'INVALID_REQUEST' } });
    });
    expect(state.repository.executions).toEqual([]);
    expect(state.run).not.toHaveBeenCalled();
  });

  it('does not report successful PREFILL when Knowledge provider fails', async () => {
    const state = setup(new PrefillKnowledgeModel(), knowledgeService(vi.fn().mockRejectedValue(new Error('provider unavailable'))));
    await withServer(state.runtime, async (post) => {
      const response = await post(input);
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ Success: false, Proposals: [] });
    });
    expect(state.repository.executions[0]?.final).toMatchObject({ Success: 'N' });
  });
});

describe.skipIf(process.env.RUN_OPENAI_INTEGRATION_TESTS !== '1')('Flow Assist semantic interpretation with OpenAI (opt-in)', () => {
  it('proposes customer, carrier and date while leaving unknown observation null', async () => {
    if (!process.env.OPENAI_MODEL || !process.env.OPENAI_API_KEY) throw new Error('OPENAI_MODEL e OPENAI_API_KEY são obrigatórios para testes live.');
    const completed = await new Runner({ tracingDisabled: true }).run(createFlowAssistAgent(process.env.OPENAI_MODEL), flowAssistInputItems(flowAssistInput));
    expect(completed.finalOutput).toEqual(flowAssistOutput);
  }, 120_000);

  it('interprets uppercase ObjectDescription without a hardcoded Runtime transformation', async () => {
    if (!process.env.OPENAI_MODEL || !process.env.OPENAI_API_KEY) throw new Error('OPENAI_MODEL e OPENAI_API_KEY são obrigatórios para testes live.');
    const input = { ...flowAssistInput, Messages: [{ IdMessage: 2001, Role: 'USER' as const, Text: 'Meu código é abc123.' }], Known: [], Targets: [{ IdProcessLineFlow: 9001, Step: 11, ObjectType: 'PROMPT' as const, Description: 'Código', ObjectDescription: 'Retorne apenas em letras maiúsculas.' }] };
    const completed = await new Runner({ tracingDisabled: true }).run(createFlowAssistAgent(process.env.OPENAI_MODEL), flowAssistInputItems(input));
    expect(completed.finalOutput).toEqual({ Proposals: [{ IdProcessLineFlow: 9001, Status: 'PROPOSED', Value: 'ABC123' }] });
  }, 120_000);
});
