import { describe, expect, it, vi } from 'vitest';
import { Runner, Usage, type AgentInputItem, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { createFlowAgent } from '../../src/agents/aidocument/specialists/flowAgent.js';
import { createSalesAgent } from '../../src/agents/aidocument/roots/salesAgent.js';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { createCustomDataExtractor } from '../../src/mcp/customDataExtractor.js';
import { createToolMetaResolver } from '../../src/mcp/toolMetaResolver.js';
import { McpObservabilityRegistry, ToolCallTracker } from '../../src/mcp/observability.js';
import { createAIDocumentRuntimeContext } from '../../src/runtime/RuntimeContext.js';
import { ExecutionLogger } from '../../src/tracing/ExecutionLogger.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';

const guidanceCases = [
  { label: 'uppercase guidance', guidance: 'Retorne somente em letras maiúsculas.', task: 'Informar o código abc123.', value: 'ABC123' },
  { label: 'arbitrary textual format', guidance: 'Envolva o código entre colchetes e acrescente o sufixo |confirmado, sem outros textos.', task: 'Informar o código abc123.', value: '[abc123]|confirmado' },
];

function promptServer(guidance: string | null | undefined) {
  const server = createFakeMcpServer();
  const description = {
    Action: 'inform_code', Description: 'Informar código', Repeatable: true, Effect: 'WRITE',
    Available: true, ExecutionCount: 0, UnavailableReason: null, RequiredInputs: ['Value'],
    ...(guidance === undefined ? {} : { ObjectDescription: guidance }),
  };
  const fallback = server.callToolResult!.bind(server);
  const calls = vi.fn(async (name: string, args: Record<string, unknown> | null, meta?: Record<string, unknown> | null) => {
    if (!['list_flow_actions', 'describe_flow_action', 'execute_flow_action'].includes(name)) return fallback(name, args, meta);
    const payload = name === 'list_flow_actions'
      ? { Actions: [{ Action: 'inform_code', Description: 'Informar código' }] }
      : name === 'describe_flow_action' ? description
      : { Success: true, Action: 'inform_code', Status: 'COMPLETED', MissingInformation: [], Output: args?.Input };
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload, isError: false };
  });
  server.callToolResult = calls;
  return { server, calls, description };
}

function result(request: ModelRequest, name: string): Record<string, any> | undefined {
  const item = (request.input as AgentInputItem[]).find((entry) => entry.type === 'function_call_result' && entry.name === name) as any;
  return item ? JSON.parse(item.output.text) : undefined;
}

function respond(output: ModelResponse['output']): ModelResponse {
  return { usage: new Usage({ requests: 1 }), output };
}

function call(name: string, args: Record<string, unknown>): ModelResponse {
  return respond([{ type: 'function_call', name, callId: name, arguments: JSON.stringify(args) }]);
}

function message(value: unknown): ModelResponse {
  return respond([{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }]);
}

// Scripted decisions verify the SDK/MCP boundary, not a real model's linguistic
// compliance. The opt-in live suite below checks semantic interpretation.
class PromptModel implements Model {
  constructor(private readonly description: Record<string, unknown>, private readonly value: string) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    if (request.tools.some((tool) => tool.name === 'list_flow_actions')) {
      if (!result(request, 'list_flow_actions')) return call('list_flow_actions', {});
      if (!result(request, 'describe_flow_action')) return call('describe_flow_action', { Action: 'inform_code' });
      expect(result(request, 'describe_flow_action')).toEqual(this.description);
      expect(request.systemInstructions).toContain('Description + ObjectDescription + RequiredInputs');
      expect(request.systemInstructions).toContain('Input.Value quando requerido');
      if (!result(request, 'execute_flow_action')) return call('execute_flow_action', { Action: 'inform_code', Input: { Value: this.value } });
      const execution = result(request, 'execute_flow_action')!;
      return message({ Status: 'COMPLETED', Summary: 'Código informado.', Results: [{ Action: 'inform_code', OutputJSON: JSON.stringify(execution.Output), Error: null }], MissingInformation: [] });
    }
    if (!result(request, 'use_flow_capabilities')) return call('use_flow_capabilities', { Task: 'Informar o código abc123.' });
    expect(result(request, 'use_flow_capabilities')?.Results).toEqual([{ Action: 'inform_code', OutputJSON: JSON.stringify({ Value: this.value }), Error: null }]);
    return message({ Response: 'Código informado.', Control: { CompletionRequested: false, Reason: null, ContextUpdates: [] } });
  }

  getStreamedResponse(): AsyncIterable<any> { throw new Error('stream não utilizado'); }
}

describe('ObjectDescription through Root -> FlowAgent -> MCP', () => {
  it.each([
    ...guidanceCases,
    { label: 'guidance without Runtime normalization or validation', guidance: 'Retorne somente em letras maiúsculas.', value: 'abc123' },
    { label: 'absent ObjectDescription', guidance: undefined, value: 'abc123' },
    { label: 'null ObjectDescription', guidance: null, value: 'abc123' },
    { label: 'empty ObjectDescription', guidance: '', value: 'abc123' },
  ])('delivers $label to the model before forming Input.Value', async ({ guidance, value }) => {
    const { server, calls, description } = promptServer(guidance);
    const context = createAIDocumentRuntimeContext({
      CompanyUUID: '14ed24ea-0000-4000-8000-000000000001',
      TurnUUID: '14ed24ea-0000-4000-8000-000000000401', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456,
      Messages: [{ IdMessage: 1001, Text: 'Informar o código abc123.' }],
    }, 'execution-test', 'session-test', { CompanyUUID: '14ed24ea-0000-4000-8000-000000000001', IdDatabase: 8, IdCompany: 1003 });
    const repository = new MemoryRepository();
    const logger = new ExecutionLogger(repository, 1);
    const observability = new McpObservabilityRegistry();
    observability.register(context, logger);
    const tracker = new ToolCallTracker();
    server.toolMetaResolver = createToolMetaResolver(observability, tracker) as typeof server.toolMetaResolver;
    server.customDataExtractor = createCustomDataExtractor(observability, tracker) as typeof server.customDataExtractor;
    const model = new PromptModel(description, value);
    // Agent-as-tool starts a nested run; give both Root and specialist the fake
    // model, rather than overriding only the outer Runner.
    const root = createSalesAgent({ mcpServer: server, model: model as any, runtimeContext: context, logger }).root;
    const runner = new Runner({ model, tracingDisabled: true });
    const completed = await runner.run(root, 'Informar o código abc123.', { context });

    expect(completed.finalOutput).toMatchObject({ Response: 'Código informado.', Control: { CompletionRequested: false } });
    expect(calls.mock.calls.map(([name]) => name)).toEqual(['list_flow_actions', 'describe_flow_action', 'execute_flow_action']);
    expect(calls.mock.calls[2]?.[1]).toEqual({ Action: 'inform_code', Input: { Value: value } });
    expect(calls.mock.calls[2]?.[2]).toMatchObject({ ca: { Execution: { IdCompany: 1003, IdProcessLine: 456, CompanyUUID: '14ed24ea-0000-4000-8000-000000000001', IdDatabase: 8 } } });
    const descriptionLog = repository.logs.find((entry) => entry.data.EventType === 'MCP_TOOL_RESULT' && entry.data.ToolName === 'describe_flow_action');
    expect(JSON.parse(descriptionLog!.data.OutputJSON!).structuredContent).toEqual(description);
    expect(repository.logs.filter((entry) => entry.data.EventType === 'MCP_TOOL_CALL')).toHaveLength(3);
    expect(repository.logs.filter((entry) => entry.data.EventType === 'MCP_TOOL_RESULT')).toHaveLength(3);
    expect(context.Resolved).toEqual({});
  });
});

const liveEnabled = process.env.RUN_OPENAI_INTEGRATION_TESTS === '1';

describe.skipIf(!liveEnabled)('ObjectDescription semantic interpretation with OpenAI (opt-in)', () => {
  it.each(guidanceCases)('forms Input.Value using $label', async ({ guidance, task, value }) => {
    if (!process.env.OPENAI_MODEL || !process.env.OPENAI_API_KEY) throw new Error('OPENAI_MODEL e OPENAI_API_KEY são obrigatórios para testes live.');
    const { server, calls } = promptServer(guidance);
    const context = createAIDocumentRuntimeContext({
      CompanyUUID: '14ed24ea-0000-4000-8000-000000000001',
      TurnUUID: '14ed24ea-0000-4000-8000-000000000402', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456,
      Messages: [{ IdMessage: 1002, Text: task }],
    }, 'execution-live', 'session-live', { CompanyUUID: '14ed24ea-0000-4000-8000-000000000001', IdDatabase: 8, IdCompany: 1003 });
    const runner = new Runner({ tracingDisabled: true });
    const completed = await runner.run(createFlowAgent(server, process.env.OPENAI_MODEL), `Task: ${task}`, { context, maxTurns: 8 });
    expect(completed.finalOutput?.Status).toBe('COMPLETED');
    expect(calls.mock.calls.map(([name]) => name)).toEqual(['list_flow_actions', 'describe_flow_action', 'execute_flow_action']);
    expect(calls.mock.calls[2]?.[1]).toEqual({ Action: 'inform_code', Input: { Value: value } });
  }, 120_000);
});
