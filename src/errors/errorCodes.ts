export const ErrorCodes = {
  InvalidRequest: 'INVALID_REQUEST',
  AgentNotFound: 'AGENT_NOT_FOUND',
  AgentRuntimeError: 'AGENT_RUNTIME_ERROR',
  AgentExecutionError: 'AGENT_EXECUTION_ERROR',
  InvalidAgentOutput: 'INVALID_AGENT_OUTPUT',
  ResolvedContextConflict: 'RESOLVED_CONTEXT_CONFLICT',
  MissingContext: 'MISSING_CONTEXT',
  McpUnavailable: 'MCP_UNAVAILABLE',
  McpTimeout: 'MCP_TIMEOUT',
  McpToolError: 'MCP_TOOL_ERROR',
  InvalidMcpMetadata: 'INVALID_MCP_METADATA',
  PersistenceError: 'PERSISTENCE_ERROR',
  SchemaInvalid: 'SCHEMA_INVALID',
  AgentSessionClosed: 'AGENT_SESSION_CLOSED',
  AgentSessionNotFound: 'AGENT_SESSION_NOT_FOUND',
  TurnInProgress: 'TURN_IN_PROGRESS',
  TurnIdempotencyConflict: 'TURN_IDEMPOTENCY_CONFLICT',
  ReceptionAgentKnowledgeNotConfigured: 'RECEPTION_AGENT_KNOWLEDGE_NOT_CONFIGURED',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
