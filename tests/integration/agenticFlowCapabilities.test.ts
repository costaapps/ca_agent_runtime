import { describe, expect, it } from 'vitest';
import { Agent, Runner, Usage, type AgentInputItem, type MCPServer, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { createSalesAgent } from '../../src/agents/aidocument/roots/salesAgent.js';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { createCustomDataExtractor } from '../../src/mcp/customDataExtractor.js';
import { createToolMetaResolver } from '../../src/mcp/toolMetaResolver.js';
import { McpObservabilityRegistry, ToolCallTracker } from '../../src/mcp/observability.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { MemorySessionRepository } from '../helpers/memorySessionRepository.js';
import type { RuntimeContextData } from '../../src/runtime/RuntimeContext.js';

function response(text: string): ModelResponse {
  return { usage: new Usage({ requests: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 }), output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] as any };
}

function call(name: string, id: string, args: Record<string, unknown>): ModelResponse {
  return { usage: new Usage({ requests: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 }), output: [{ type: 'function_call', name, callId: id, arguments: JSON.stringify(args) }] as any };
}

function currentItems(request: ModelRequest): AgentInputItem[] {
  const items = request.input as AgentInputItem[];
  let lastUser = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item && 'role' in item && item.role === 'user') { lastUser = index; break; }
  }
  return items.slice(lastUser < 0 ? 0 : lastUser);
}

function toolResults(request: ModelRequest, name: string): Array<Record<string, any>> {
  return currentItems(request)
    .filter((entry) => entry.type === 'function_call_result' && entry.name === name)
    .map((entry) => JSON.parse((entry as any).output.text) as Record<string, any>);
}

function toolResult(request: ModelRequest, name: string): Record<string, any> | null {
  return toolResults(request, name).at(-1) ?? null;
}

class TwoTurnFlowModel implements Model {
  readonly requests: ModelRequest[] = [];
  readonly describedEffects: unknown[] = [];
  private turn = 0;

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const names = request.tools.map((tool) => tool.name);
    if (names.includes('list_flow_actions')) {
      if (!toolResult(request, 'list_flow_actions')) return call('list_flow_actions', `list-${this.turn}`, {});
      const descriptions = toolResults(request, 'describe_flow_action');
      const executions = toolResults(request, 'execute_flow_action');
      for (const action of this.turn === 1 ? ['find_customer', 'set_delivery_date', 'set_carrier'] : ['set_carrier']) {
        const description = descriptions.find((item) => item.Action === action);
        if (!description) return call('describe_flow_action', `describe-${this.turn}-${action}`, { Action: action });
        if (!executions.some((item) => item.Action === action)) {
          this.describedEffects.push(description.Effect);
          const value = action === 'find_customer' ? 'Café do Mercado' : action === 'set_delivery_date' ? '2026-10-05' : this.turn === 1 ? 'Jadlog' : '12';
          return call('execute_flow_action', `execute-${this.turn}-${action}`, { Action: action, Input: { Value: value } });
        }
      }
      const carrier = executions.find((item) => item.Action === 'set_carrier')!;
      return response(JSON.stringify({
        Status: carrier.Status, Summary: carrier.Status === 'NEEDS_INPUT' ? 'Escolha uma transportadora.' : 'Transportadora definida.',
        Results: executions.map((execution) => ({ Action: execution.Action, OutputJSON: execution.Output === null ? null : JSON.stringify(execution.Output), Error: null })),
        MissingInformation: carrier.MissingInformation,
      }));
    }
    if (names.includes('use_flow_capabilities')) {
      const flow = toolResult(request, 'use_flow_capabilities');
      if (!flow) {
        this.turn += 1;
        return call('use_flow_capabilities', `root-${this.turn}`, { Task: this.turn === 1 ? 'Montar pedido com cliente, entrega e transportadora.' : 'Definir a transportadora escolhida.', Context: this.turn === 1 ? 'Cliente Café do Mercado, entrega 2026-10-05, transportadora Jadlog.' : 'Cliente escolheu opção 12.' });
      }
      const output = JSON.parse(flow.Results.find((item: { Action: string }) => item.Action === 'set_carrier').OutputJSON);
      const userResponse = flow.Status === 'NEEDS_INPUT'
        ? `Encontrei ${output.Candidates.map((item: { Label: string }) => item.Label).join(' ou ')}. Qual você prefere?`
        : `Transportadora ${output.Label} definida.`;
      return response(JSON.stringify({ Response: userResponse, Control: { CompletionRequested: false, Reason: null, ContextUpdates: [] } }));
    }
    throw new Error('Ferramentas inesperadas para o Fake Model.');
  }

  getStreamedResponse(): AsyncIterable<any> { throw new Error('stream não utilizado'); }
}

function capabilityServer() {
  const server = createFakeMcpServer();
  const listed = { Actions: [
    { Action: 'find_customer', Description: 'Busca cliente.' },
    { Action: 'set_delivery_date', Description: 'Define data de entrega.' },
    { Action: 'set_carrier', Description: 'Define transportadora.' },
    { Action: 'review_document', Description: 'Revisa o documento.' },
  ] };
  const invocations: Array<{ action: string; input: unknown; status: string }> = [];
  const previous = server.callToolResult!.bind(server);
  server.callToolResult = async (name: string, args: Record<string, unknown> | null, meta?: Record<string, unknown> | null) => {
    if (!['list_flow_actions', 'describe_flow_action', 'execute_flow_action'].includes(name)) return previous(name, args, meta);
    const action = args?.Action as string;
    let value: Record<string, unknown> = name === 'list_flow_actions' ? listed : {
      Action: action, Description: listed.Actions.find((item) => item.Action === action)?.Description,
      Repeatable: true, Effect: action === 'find_customer' ? 'READ' : 'WRITE', Available: true,
      ExecutionCount: 0, UnavailableReason: null, RequiredInputs: ['Value'],
    };
    if (name === 'execute_flow_action') {
      const input = args?.Input as { Value?: string };
      const ambiguous = input.Value === 'Jadlog';
      value = {
        Success: true, Action: action, Status: ambiguous ? 'NEEDS_INPUT' : 'COMPLETED',
        MissingInformation: ambiguous ? ['Value'] : [],
        Output: action === 'find_customer' ? { CardCode: 'C20000', CardName: 'Café do Mercado' }
          : action === 'set_delivery_date' ? { Value: '2026-10-05' }
          : ambiguous
          ? { Status: 'AMBIGUOUS', RequestedValue: 'Jadlog', Candidates: [{ Value: '12', Label: 'Jadlog' }, { Value: '18', Label: 'Jadlog Transportes' }] }
          : { Status: 'RESOLVED', Value: '12', Label: 'Jadlog' },
      };
      invocations.push({ action, input, status: value.Status as string });
    }
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false };
  };
  return { server, invocations };
}

describe('Agentic Flow V1 contract path', () => {
  it('runs AUTO, PROMPT and CFL, then continues CFL NEEDS_INPUT in a new Turn', async () => {
    const model = new TwoTurnFlowModel();
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    const { server, invocations } = capabilityServer();
    const observability = new McpObservabilityRegistry();
    const tracker = new ToolCallTracker();
    server.toolMetaResolver = createToolMetaResolver(observability, tracker) as MCPServer['toolMetaResolver'];
    server.customDataExtractor = createCustomDataExtractor(observability, tracker) as MCPServer['customDataExtractor'];
    const registry = new AgentRegistry(undefined, { 'sales-agent': (context) => createSalesAgent({ ...context, model: model as any }) });
    const runtime = new AgentRuntime({
      repository, sessionRepository, registry, mcpServer: server, observability, model: 'test-model', tracingEnabled: false, traceIncludeSensitiveData: false,
      tenantScope: { CompanyUUID: '14ed24ea-0000-4000-8000-000000000001', IdDatabase: 8, IdCompany: 1003 },
      runner: { async run(agent: Agent<RuntimeContextData, any>, input: string | AgentInputItem[], context: RuntimeContextData, _tracing: any, session?: any) {
        const runner = new Runner({ model: model as any, tracingDisabled: true, workflowName: 'agentic-flow-test' });
        const result = await runner.run(agent, input, { context, stream: false, session });
        return { finalOutput: result.finalOutput, lastAgent: result.lastAgent ? { name: result.lastAgent.name } : undefined };
      } },
    });
    const base = { CompanyUUID: '14ed24ea-0000-4000-8000-000000000001', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456,
      AgentContext: { Name: 'Pedido', Objective: 'Montar pedido.', Instructions: 'Use as capabilities.', CompletionCriteria: ['Pedido criado'] } };

    const first = await runtime.runTurn({ ...base, TurnUUID: '14ed24ea-0000-4000-8000-000000000301', Messages: [{ IdMessage: 1001, Text: 'Pedido para Café do Mercado, entrega 2026-10-05 pela Jadlog.' }] });
    expect(first).toMatchObject({ statusCode: 200, response: { Success: true, Response: expect.stringContaining('Qual você prefere?') } });
    const second = await runtime.runTurn({ ...base, TurnUUID: '14ed24ea-0000-4000-8000-000000000302', Messages: [{ IdMessage: 1002, Text: 'A primeira, Jadlog.' }] });
    expect(second).toMatchObject({ statusCode: 200, response: { Success: true, Response: 'Transportadora Jadlog definida.' } });
    expect((first.response as any).SessionUUID).toBe((second.response as any).SessionUUID);
    expect(invocations).toEqual([
      { action: 'find_customer', input: { Value: 'Café do Mercado' }, status: 'COMPLETED' },
      { action: 'set_delivery_date', input: { Value: '2026-10-05' }, status: 'COMPLETED' },
      { action: 'set_carrier', input: { Value: 'Jadlog' }, status: 'NEEDS_INPUT' },
      { action: 'set_carrier', input: { Value: '12' }, status: 'COMPLETED' },
    ]);
    expect(model.describedEffects).toContain('WRITE');
    expect(model.describedEffects).toContain('READ');
    expect(model.requests.some((request) => JSON.stringify(toolResult(request, 'list_flow_actions')).includes('review_document'))).toBe(true);
    const flowResults = model.requests.flatMap((request) => currentItems(request).filter((item) => item.type === 'function_call_result' && item.name === 'use_flow_capabilities').map((item) => JSON.parse((item as any).output.text)));
    expect(flowResults.some((result) => result.Status === 'NEEDS_INPUT' && JSON.parse(result.Results.find((item: { Action: string }) => item.Action === 'set_carrier').OutputJSON).Candidates.length === 2)).toBe(true);
    expect(flowResults.some((result) => result.Status === 'COMPLETED' && JSON.parse(result.Results.find((item: { Action: string }) => item.Action === 'set_carrier').OutputJSON).Status === 'RESOLVED')).toBe(true);
    expect(flowResults.some((result) => JSON.parse(result.Results.find((item: { Action: string }) => item.Action === 'find_customer').OutputJSON).CardCode === 'C20000')).toBe(true);
    expect(repository.logs.filter((entry) => entry.data.EventType === 'MCP_TOOL_CALL').map((entry) => entry.data.ToolName)).toEqual([
      'list_flow_actions', 'describe_flow_action', 'execute_flow_action', 'describe_flow_action', 'execute_flow_action',
      'describe_flow_action', 'execute_flow_action', 'list_flow_actions', 'describe_flow_action', 'execute_flow_action',
    ]);
    expect(repository.logs.filter((entry) => entry.data.EventType === 'RUNTIME_END')).toHaveLength(2);
    expect(sessionRepository.sessions).toHaveLength(1);
  });
});
