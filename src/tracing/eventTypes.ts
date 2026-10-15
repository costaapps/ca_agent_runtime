export const ExecutionEventTypes = {
  RuntimeStart: 'RUNTIME_START',
  AgentStart: 'AGENT_START',
  Handoff: 'HANDOFF',
  McpToolCall: 'MCP_TOOL_CALL',
  McpToolResult: 'MCP_TOOL_RESULT',
  AgentOutput: 'AGENT_OUTPUT',
  RuntimeEnd: 'RUNTIME_END',
  RuntimeWarning: 'RUNTIME_WARNING',
  RuntimeError: 'RUNTIME_ERROR',
  KnowledgeSearch: 'KNOWLEDGE_SEARCH',
} as const;

export type ExecutionEventType = typeof ExecutionEventTypes[keyof typeof ExecutionEventTypes];
