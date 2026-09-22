import type { MCPServer } from '@openai/agents';
import { createToolFilter } from '../runtime/ToolPolicies.js';

type FakeTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export interface FakeMcpServerOptions {
  executeFlowError?: { Code: string; Message: string };
  requestHandoffError?: { Code: string; Message: string };
}

export function createFakeMcpServer(options: FakeMcpServerOptions = {}): MCPServer {
  const tools: FakeTool[] = [
    {
      name: 'get_chat_history',
      description: 'Retorna o histórico enxuto do chat atual.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
    {
      name: 'get_process_line_flow_state',
      description: 'Retorna o estado enxuto da Flow atual.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
    {
      name: 'get_products',
      description: 'Busca produtos ativos da empresa atual.',
      inputSchema: {
        type: 'object',
        properties: {
          ItemCode: { type: 'string' },
          ItemName: { type: 'string' },
          Limit: { type: 'number' },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'get_pricelists',
      description: 'Busca listas de preços da empresa atual.',
      inputSchema: {
        type: 'object',
        properties: { Limit: { type: 'number' } },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'resolve_product',
      description: 'Confirma um produto selecionado e publica o IdItem resolvido.',
      inputSchema: {
        type: 'object',
        properties: { IdItem: { type: 'number' } },
        required: ['IdItem'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_products_pricelists',
      description: 'Busca os preços do produto confirmado nas listas de preços.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
    {
      name: 'list_flow_actions',
      description: 'Lista as capabilities de negócio publicadas e disponíveis no AIDocument.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
    {
      name: 'describe_flow_action',
      description: 'Descreve uma capability publicada e seus dados obrigatórios.',
      inputSchema: {
        type: 'object',
        properties: { Action: { type: 'string' } },
        required: ['Action'],
        additionalProperties: false,
      },
    },
    {
      name: 'execute_flow_action',
      description: 'Executa uma capability publicada com os dados de negócio informados.',
      inputSchema: {
        type: 'object',
        properties: { Action: { type: 'string' }, Input: { type: 'object' } },
        required: ['Action', 'Input'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_navigation_destinations',
      description: 'Lista os destinos autorizados para a navegação atual.',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
    {
      name: 'request_handoff',
      description: 'Solicita um Handoff durável para um destino autorizado.',
      inputSchema: {
        type: 'object',
        properties: {
          DestinationRef: { type: 'string' },
          Reason: { type: 'string' },
          Summary: { type: 'string' },
        },
        required: ['DestinationRef', 'Reason', 'Summary'],
        additionalProperties: false,
      },
    },
  ];
  const callTool = async (toolName: string) => {
    if (toolName === 'get_chat_history') return [{ type: 'text', text: JSON.stringify({ Messages: [] }) }];
    if (toolName === 'get_products') return [{ type: 'text', text: JSON.stringify({ Products: [] }) }];
    if (toolName === 'get_pricelists') return [{ type: 'text', text: JSON.stringify({ PriceLists: [] }) }];
    if (toolName === 'resolve_product') return [{ type: 'text', text: JSON.stringify({ Product: { IdItem: 10 } }) }];
    if (toolName === 'get_products_pricelists') return [{ type: 'text', text: JSON.stringify({ ProductsPriceLists: [] }) }];
    if (toolName === 'list_flow_actions') return [{ type: 'text', text: JSON.stringify({ Actions: [{ Action: 'get_customer_details', Description: 'Consulta os dados master do cliente.' }] }) }];
    if (toolName === 'describe_flow_action') return [{ type: 'text', text: JSON.stringify({ Action: 'get_customer_details', Description: 'Consulta os dados master do cliente.', Repeatable: true, Available: true, ExecutionCount: 0, UnavailableReason: null, RequiredInputs: [] }) }];
    if (toolName === 'execute_flow_action' && options.executeFlowError) {
      return [{ type: 'text', text: JSON.stringify({ Success: false, Action: 'get_customer_details', Output: null, Error: options.executeFlowError }) }];
    }
    if (toolName === 'execute_flow_action') return [{ type: 'text', text: JSON.stringify({ Success: true, Action: 'get_customer_details', Output: { CustomerCode: 'C000123' } }) }];
    if (toolName === 'list_navigation_destinations') return [{ type: 'text', text: JSON.stringify({ Destinations: [
      { DestinationRef: 'nav_sales', Kind: 'MENU', Description: 'Vendas', MenuGroup: 'Atendimento', Keywords: 'comprar produto orçamento' },
      { DestinationRef: 'nav_support', Kind: 'MENU', Description: 'Suporte', MenuGroup: 'Atendimento', Keywords: 'problema ajuda suporte' },
      { DestinationRef: 'nav_home', Kind: 'HOME', Description: 'Início', MenuGroup: null, Keywords: 'voltar início menu' },
    ] }) }];
    if (toolName === 'request_handoff') return [{ type: 'text', text: JSON.stringify({ Status: 'REQUESTED', RequestUUID: 'fake-request-uuid' }) }];
    return [{ type: 'text', text: JSON.stringify({ Steps: [] }) }];
  };
  return {
    name: 'fake-mcp',
    cacheToolsList: false,
    useStructuredContent: true,
    toolFilter: createToolFilter() as any,
    async connect() {},
    async close() {},
    async listTools() { return tools; },
    async invalidateToolsCache() {},
    callTool,
    async callToolResult(toolName: string) {
      if (toolName === 'execute_flow_action' && options.executeFlowError) {
        return {
          content: await callTool(toolName),
          structuredContent: { Success: false, Action: 'get_customer_details', Output: null, Error: options.executeFlowError },
          _meta: { ca: { FlowInvocation: { InvocationUUID: 'fake-invocation-uuid' } } },
          isError: true,
        };
      }
      if (toolName === 'request_handoff' && options.requestHandoffError) {
        return {
          content: await callTool(toolName),
          structuredContent: { Status: 'FAILED', Error: options.requestHandoffError },
          isError: true,
        };
      }
      if (toolName === 'resolve_product') {
        return {
          content: await callTool(toolName),
          structuredContent: { Product: { IdItem: 10, ItemCode: 'CAR-10', ItemName: 'Carro', LongDescription: null, Price: 100 } },
          _meta: { ca: { Resolved: { IdItem: 10 } } },
          isError: false,
        };
      }
      return {
        content: await callTool(toolName),
        structuredContent: toolName === 'get_chat_history'
          ? { Messages: [] }
          : toolName === 'get_process_line_flow_state'
            ? { Steps: [] }
            : toolName === 'get_products'
              ? { Products: [] }
            : toolName === 'get_pricelists'
              ? { PriceLists: [] }
                : toolName === 'get_products_pricelists'
                  ? { ProductsPriceLists: [] }
                  : toolName === 'list_flow_actions'
                    ? { Actions: [{ Action: 'get_customer_details', Description: 'Consulta os dados master do cliente.' }] }
                    : toolName === 'describe_flow_action'
                    ? { Action: 'get_customer_details', Description: 'Consulta os dados master do cliente.', Repeatable: true, Available: true, ExecutionCount: 0, UnavailableReason: null, RequiredInputs: [] }
                      : toolName === 'list_navigation_destinations'
                        ? { Destinations: [
                          { DestinationRef: 'nav_sales', Kind: 'MENU', Description: 'Vendas', MenuGroup: 'Atendimento', Keywords: 'comprar produto orçamento' },
                          { DestinationRef: 'nav_support', Kind: 'MENU', Description: 'Suporte', MenuGroup: 'Atendimento', Keywords: 'problema ajuda suporte' },
                          { DestinationRef: 'nav_home', Kind: 'HOME', Description: 'Início', MenuGroup: null, Keywords: 'voltar início menu' },
                        ] }
                        : toolName === 'request_handoff'
                          ? { Status: 'REQUESTED', RequestUUID: 'fake-request-uuid' }
                          : { Success: true, Action: 'get_customer_details', Output: { CustomerCode: 'C000123' } },
        isError: false,
      };
    },
  } as unknown as MCPServer;
}
