export interface AgentRunSuccess {
  Success: true;
  ExecutionUUID: string;
  Output: Record<string, unknown>;
}

export interface AgentRunFailure {
  Success: false;
  ExecutionUUID?: string;
  Output: null;
  Error: {
    Code: string;
    Message: string;
  };
}

export type AgentRunOutput = AgentRunSuccess | AgentRunFailure;
