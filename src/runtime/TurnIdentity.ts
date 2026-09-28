import { createHash } from 'node:crypto';
import type { AgentTurnInput } from '../api/contracts/agentTurnInput.js';

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, stableValue(nested)]));
  }
  return value;
}

export function canonicalTurnPayload(input: AgentTurnInput): string {
  return JSON.stringify(stableValue({
    Agent: input.Agent,
    IdCompany: input.IdCompany,
    IdChat: input.IdChat,
    IdProcessLine: input.IdProcessLine,
    TurnSource: input.TurnSource ?? 'MESSAGE',
    Messages: input.Messages.map((message) => ({ IdMessage: message.IdMessage, Text: message.Text })),
    ProcessContextRevision: input.ProcessContextRevision ?? 0,
    ProcessContext: input.ProcessContext ?? { System: {}, Facts: {}, BusinessReferences: {}, CurrentIntent: {} },
    ActivationContext: input.ActivationContext ?? null,
    AgentConfiguration: input.AgentConfiguration ?? null,
  }));
}

/** Hash format used before AgentConfiguration became part of turn identity. */
export function hashLegacyTurnPayload(input: AgentTurnInput): string {
  const legacyPayload = JSON.stringify(stableValue({
    Agent: input.Agent,
    IdCompany: input.IdCompany,
    IdChat: input.IdChat,
    IdProcessLine: input.IdProcessLine,
    TurnSource: input.TurnSource ?? 'MESSAGE',
    Messages: input.Messages.map((message) => ({ IdMessage: message.IdMessage, Text: message.Text })),
    ProcessContextRevision: input.ProcessContextRevision ?? 0,
    ProcessContext: input.ProcessContext ?? { System: {}, Facts: {}, BusinessReferences: {}, CurrentIntent: {} },
    ActivationContext: input.ActivationContext ?? null,
  }));
  return createHash('sha256').update(legacyPayload).digest('hex');
}

export function canonicalTurnInput(input: AgentTurnInput): string {
  return JSON.stringify(stableValue({ TurnUUID: input.TurnUUID, ...JSON.parse(canonicalTurnPayload(input)) }));
}

export function hashTurnPayload(input: AgentTurnInput): string {
  return createHash('sha256').update(canonicalTurnPayload(input)).digest('hex');
}
