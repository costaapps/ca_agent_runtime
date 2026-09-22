import { describe, expect, it } from 'vitest';
import { Agent, Runner, Usage, type AgentInputItem, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { createSalesAgent } from '../../src/agents/aidocument/roots/salesAgent.js';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { createCustomDataExtractor } from '../../src/mcp/customDataExtractor.js';
import { createToolMetaResolver } from '../../src/mcp/toolMetaResolver.js';
import { McpObservabilityRegistry, ToolCallTracker } from '../../src/mcp/observability.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { MemorySessionRepository } from '../helpers/memorySessionRepository.js';
import type { RuntimeContextData } from '../../src/runtime/RuntimeContext.js';

function hasToolResult(request: ModelRequest, name: string): boolean {
  return Array.isArray(request.input) && request.input.some((item) => item.type === 'function_call_result' && item.name === name);
}

function functionCall(name: string, callId: string, args: Record<string, unknown>): ModelResponse {
  return { usage: new Usage({ requests: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 }), output: [{ type: 'function_call', name, callId, arguments: JSON.stringify(args) }] as any };
}

function message(text: string): ModelResponse {
  return { usage: new Usage({ requests: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 }), output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] as any };
}

function rootOutput(response: string): string {
  return JSON.stringify({ Response: response, Control: { CompletionRequested: false, Reason: null, ContextUpdates: [] } });
}

class DeterministicAIDocumentModel implements Model {
  requests: ModelRequest[] = [];

  constructor(private readonly flowFailure = false) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const toolNames = request.tools.map((tool) => tool.name);
    if (toolNames.includes('list_flow_actions')) {
      if (!hasToolResult(request, 'list_flow_actions')) return functionCall('list_flow_actions', 'flow-list', {});
      if (!hasToolResult(request, 'describe_flow_action')) return functionCall('describe_flow_action', 'flow-describe', { Action: 'get_customer_details' });
      if (!hasToolResult(request, 'execute_flow_action')) return functionCall('execute_flow_action', 'flow-execute', { Action: 'get_customer_details', Input: {} });
      return message(JSON.stringify({
        Status: this.flowFailure ? 'FAILED' : 'COMPLETED',
        Summary: this.flowFailure ? 'A capability retornou erro.' : 'Capability executada.',
        Results: [{
          Action: 'get_customer_details',
          OutputJSON: this.flowFailure ? null : JSON.stringify({ CustomerCode: 'C000123' }),
          Error: this.flowFailure ? { Code: 'FLOW_ACTION_ALREADY_EXECUTED', Message: 'Já executada.' } : null,
        }],
        MissingInformation: [],
      }));
    }
    if (toolNames.includes('use_flow_capabilities')) {
      if (!hasToolResult(request, 'use_flow_capabilities')) return functionCall('use_flow_capabilities', 'root-flow', { Task: 'Consulte os dados do cliente atual.', Context: 'A tarefa deve usar a capability publicada.' });
      return message(rootOutput(this.flowFailure ? 'A capability não pôde ser executada.' : 'Consultei a capability e encontrei o cliente C000123.'));
    }
    return message(rootOutput('Ok'));
  }

  getStreamedResponse(): AsyncIterable<any> {
    throw new Error('stream não utilizado neste teste');
  }
}

class NavigationDeterministicModel implements Model {
  requests: ModelRequest[] = [];

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const toolNames = request.tools.map((tool) => tool.name);
    if (toolNames.includes('list_navigation_destinations')) {
      if (!hasToolResult(request, 'list_navigation_destinations')) return functionCall('list_navigation_destinations', 'navigation-list', {});
      if (!hasToolResult(request, 'request_handoff')) return functionCall('request_handoff', 'navigation-request', { DestinationRef: 'nav_sales', Reason: 'Intenção comercial inequívoca.', Summary: 'Cliente deseja comprar.' });
      return message(JSON.stringify({ Status: 'HANDOFF_REQUESTED', Summary: 'Handoff solicitado para Vendas.', Destination: 'Vendas', Clarification: null, Error: null }));
    }
    if (toolNames.includes('use_navigation')) {
      if (!hasToolResult(request, 'use_navigation')) return functionCall('use_navigation', 'root-navigation', { Task: 'Encontrar o destino comercial para a compra.', Context: 'O cliente quer comprar um produto.' });
      return message(rootOutput('Vou direcionar seu atendimento para o destino adequado.'));
    }
    return message(rootOutput('Ok'));
  }

  getStreamedResponse(): AsyncIterable<any> {
    throw new Error('stream não utilizado neste teste');
  }
}

function createTestRuntime(model: DeterministicAIDocumentModel, server: ReturnType<typeof createFakeMcpServer>, repository: MemoryRepository, sessionRepository: MemorySessionRepository) {
  const observability = new McpObservabilityRegistry();
  const tracker = new ToolCallTracker();
  server.toolMetaResolver = createToolMetaResolver(observability, tracker) as any;
  server.customDataExtractor = createCustomDataExtractor(observability, tracker) as any;
  const registry = new AgentRegistry(undefined, {
    'sales-agent': (context) => createSalesAgent({ ...context, model: model as any }),
  });
  const runtime = new AgentRuntime({
    repository,
    sessionRepository,
    registry,
    runner: {
      async run(agent: Agent<RuntimeContextData, any>, input: string | AgentInputItem[], context: RuntimeContextData, _tracing: any, session?: any) {
        const runner = new Runner({ model: model as any, tracingDisabled: true, workflowName: 'test' });
        const result = await runner.run(agent, input, { context, stream: false, session });
        return { finalOutput: result.finalOutput, lastAgent: result.lastAgent ? { name: result.lastAgent.name } : undefined };
      },
    },
    mcpServer: server,
    observability,
    model: 'test-model',
    tracingEnabled: false,
    traceIncludeSensitiveData: false,
  });
  return { runtime, observability };
}

describe('AIDocument full Agents SDK path with fake model', () => {
  it('runs RootAgent -> use_flow_capabilities -> FlowAgent -> list/describe/execute and persists Session items', async () => {
    const model = new DeterministicAIDocumentModel();
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    const server = createFakeMcpServer();
    const { runtime } = createTestRuntime(model, server, repository, sessionRepository);

    const result = await runtime.runTurn({
      TurnUUID: '14ed24ea-0000-4000-8000-000000000001', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456,
      Messages: [{ IdMessage: 1001, Text: 'Consulte o cliente atual.' }],
    });

    expect(result).toMatchObject({ statusCode: 200, response: { Success: true, Response: 'Consultei a capability e encontrei o cliente C000123.' } });
    expect(model.requests.some((request) => request.tools.some((tool) => tool.name === 'use_flow_capabilities'))).toBe(true);
    expect(model.requests.some((request) => request.tools.some((tool) => tool.name === 'list_flow_actions'))).toBe(true);
    const flowRequest = model.requests.find((request) => request.tools.some((tool) => tool.name === 'list_flow_actions'));
    expect(flowRequest?.outputType).toMatchObject({ type: 'json_schema' });
    expect(JSON.stringify(flowRequest?.outputType)).toContain('OutputJSON');
    const rootFollowUpInput = model.requests.at(-1)?.input as AgentInputItem[];
    const flowResult = rootFollowUpInput.find((item) => item.type === 'function_call_result' && item.name === 'use_flow_capabilities') as any;
    expect(JSON.parse(flowResult.output.text)).toMatchObject({ Results: [{ OutputJSON: '{"CustomerCode":"C000123"}' }] });
    expect(repository.logs.filter((entry) => entry.data.EventType === 'MCP_TOOL_CALL').map((entry) => entry.data.ToolName)).toEqual(['list_flow_actions', 'describe_flow_action', 'execute_flow_action']);
    expect(repository.logs.filter((entry) => entry.data.EventType === 'MCP_TOOL_RESULT').map((entry) => entry.data.ToolName)).toEqual(['list_flow_actions', 'describe_flow_action', 'execute_flow_action']);
    const sessionUUID = sessionRepository.sessions[0]?.SessionUUID;
    expect(sessionUUID).toBeDefined();
    expect(await sessionRepository.getItems(sessionUUID!)).toEqual(expect.arrayContaining([{ role: 'user', content: 'Consulte o cliente atual.' }]));
    expect(sessionRepository.executionUUIDs.get(sessionUUID!)).toEqual(expect.arrayContaining([repository.executions[0]!.data.ExecutionUUID]));
  });

  it('keeps execute_flow_action errors inside FlowAgent and completes the Root Agent turn', async () => {
    const model = new DeterministicAIDocumentModel(true);
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    const server = createFakeMcpServer({ executeFlowError: { Code: 'FLOW_ACTION_ALREADY_EXECUTED', Message: 'Já executada.' } });
    const { runtime } = createTestRuntime(model, server, repository, sessionRepository);

    const result = await runtime.runTurn({
      TurnUUID: '14ed24ea-0000-4000-8000-000000000002', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 457,
      Messages: [{ IdMessage: 1002, Text: 'Consulte o cliente atual.' }],
    });

    expect(result).toMatchObject({ statusCode: 200, response: { Success: true, Response: 'A capability não pôde ser executada.' } });
    expect(repository.logs.filter((entry) => entry.data.EventType === 'MCP_TOOL_RESULT' && entry.data.ToolName === 'execute_flow_action')).toHaveLength(1);
    expect(repository.logs.some((entry) => entry.data.EventType === 'RUNTIME_END')).toBe(true);
    expect(repository.logs.some((entry) => entry.data.EventType === 'RUNTIME_ERROR')).toBe(false);
  });

  it('runs RootAgent -> use_navigation -> NavigationAgent -> list/request_handoff', async () => {
    const model = new NavigationDeterministicModel();
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    const server = createFakeMcpServer();
    const { runtime } = createTestRuntime(model as any, server, repository, sessionRepository);

    const result = await runtime.runTurn({
      TurnUUID: '14ed24ea-0000-4000-8000-000000000003', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 458,
      Messages: [{ IdMessage: 1003, Text: 'Quero comprar um produto.' }],
    });

    expect(result).toMatchObject({ statusCode: 200, response: { Success: true, Response: 'Vou direcionar seu atendimento para o destino adequado.' } });
    expect(model.requests.some((request) => request.tools.some((tool) => tool.name === 'use_navigation'))).toBe(true);
    expect(model.requests.some((request) => request.tools.some((tool) => tool.name === 'list_navigation_destinations'))).toBe(true);
    expect(repository.logs.filter((entry) => entry.data.EventType === 'MCP_TOOL_CALL').map((entry) => entry.data.ToolName)).toEqual(['list_navigation_destinations', 'request_handoff']);
    expect(repository.logs.filter((entry) => entry.data.EventType === 'MCP_TOOL_RESULT').map((entry) => entry.data.ToolName)).toEqual(['list_navigation_destinations', 'request_handoff']);
    const rootFollowUpInput = model.requests.at(-1)?.input as AgentInputItem[];
    const navigationResult = rootFollowUpInput.find((item) => item.type === 'function_call_result' && item.name === 'use_navigation') as any;
    expect(JSON.parse(navigationResult.output.text)).toMatchObject({ Status: 'HANDOFF_REQUESTED', Destination: 'Vendas' });
  });
});
