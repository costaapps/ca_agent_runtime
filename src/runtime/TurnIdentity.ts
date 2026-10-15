import { createHash } from 'node:crypto';
import type { AgentTurnInput } from '../api/contracts/agentTurnInput.js';
import { effectiveKnowledgeConfiguration } from '../api/contracts/knowledgeConfiguration.js';

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
    KnowledgeConfiguration: effectiveKnowledgeConfiguration(input.KnowledgeConfiguration),
    AgentContext: input.AgentContext ?? null,
  }));
}

/** Hash format immediately before the module AgentContext contract. */
export function hashPreAgentContextTurnPayload(input: AgentTurnInput): string {
  const payload = JSON.parse(canonicalTurnPayload(input)) as Record<string, unknown>;
  delete payload.AgentContext;
  return createHash('sha256').update(JSON.stringify(stableValue(payload))).digest('hex');
}

/** Hash format before KnowledgeConfiguration, retaining AgentConfiguration. */
export function hashPreKnowledgeTurnPayload(input: AgentTurnInput): string {
  const payload = JSON.stringify(stableValue({
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
  return createHash('sha256').update(payload).digest('hex');
}

/** Historical format before AgentConfiguration. */
export function hashLegacyTurnPayload(input: AgentTurnInput): string {
  const payload = JSON.parse(canonicalTurnPayload(input)) as Record<string, unknown>;
  delete payload.KnowledgeConfiguration;
  delete payload.AgentConfiguration;
  delete payload.AgentContext;
  return createHash('sha256').update(JSON.stringify(stableValue(payload))).digest('hex');
}

export function canonicalTurnInput(input: AgentTurnInput): string {
  return JSON.stringify(stableValue({ TurnUUID: input.TurnUUID, ...JSON.parse(canonicalTurnPayload(input)) }));
}

export function hashTurnPayload(input: AgentTurnInput): string {
  return createHash('sha256').update(canonicalTurnPayload(input)).digest('hex');
}
