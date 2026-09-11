import type { MCPServer } from '@openai/agents';

type FakeTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export function createFakeMcpServer(): MCPServer {
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
  ];
  const callTool = async (toolName: string) => {
    if (toolName === 'get_chat_history') return [{ type: 'text', text: JSON.stringify({ Messages: [] }) }];
    if (toolName === 'get_products') return [{ type: 'text', text: JSON.stringify({ Products: [] }) }];
    if (toolName === 'get_pricelists') return [{ type: 'text', text: JSON.stringify({ PriceLists: [] }) }];
    if (toolName === 'resolve_product') return [{ type: 'text', text: JSON.stringify({ Product: { IdItem: 10 } }) }];
    if (toolName === 'get_products_pricelists') return [{ type: 'text', text: JSON.stringify({ ProductsPriceLists: [] }) }];
    return [{ type: 'text', text: JSON.stringify({ Steps: [] }) }];
  };
  return {
    name: 'fake-mcp',
    cacheToolsList: false,
    useStructuredContent: true,
    async connect() {},
    async close() {},
    async listTools() { return tools; },
    async invalidateToolsCache() {},
    callTool,
    async callToolResult(toolName: string) {
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
                : { ProductsPriceLists: [] },
        isError: false,
      };
    },
  } as unknown as MCPServer;
}
