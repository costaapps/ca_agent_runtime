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
  ];
  const callTool = async (toolName: string) => {
    if (toolName === 'get_chat_history') return [{ type: 'text', text: JSON.stringify({ Messages: [] }) }];
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
      return {
        content: await callTool(toolName),
        structuredContent: toolName === 'get_chat_history' ? { Messages: [] } : { Steps: [] },
        isError: false,
      };
    },
  } as unknown as MCPServer;
}
