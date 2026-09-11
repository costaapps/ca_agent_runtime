import { createHash } from 'node:crypto';
import type { AgentTurnInput } from '../api/contracts/agentTurnInput.js';

export function canonicalTurnPayload(input: AgentTurnInput): string {
  return JSON.stringify({
    Agent: input.Agent,
    IdCompany: input.IdCompany,
    IdChat: input.IdChat,
    IdProcessLine: input.IdProcessLine,
    Messages: input.Messages.map((message) => ({ IdMessage: message.IdMessage, Text: message.Text })),
  });
}

export function hashTurnPayload(input: AgentTurnInput): string {
  return createHash('sha256').update(canonicalTurnPayload(input)).digest('hex');
}
