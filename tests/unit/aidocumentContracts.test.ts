import { describe, expect, it } from 'vitest';
import { AgentTurnInputSchema } from '../../src/api/contracts/agentTurnInput.js';
import { AIDocumentRootOutputSchema } from '../../src/api/contracts/agentTurnOutput.js';
import { FlowAgentInputSchema, FlowAgentOutputSchema } from '../../src/agents/aidocument/flowAgent.js';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';

describe('AIDocument contracts', () => {
  it('validates the new turn and fixed root output', () => {
    expect(AgentTurnInputSchema.safeParse({
      TurnUUID: '14ed24ea-0000-4000-8000-000000000001', Agent: 'sales-agent', IdCompany: '1003', IdChat: 123, IdProcessLine: 456,
      Messages: [{ IdMessage: 1001, Text: 'Quero comprar' }],
    }).success).toBe(true);
    expect(AIDocumentRootOutputSchema.safeParse({ Response: 'Ok', Control: { CompletionRequested: false, Reason: null } }).success).toBe(true);
    expect(AIDocumentRootOutputSchema.safeParse({ Response: 'Ok', Control: { CompletionRequested: 'false' } }).success).toBe(false);
  });

  it('validates FlowAgent Task + optional Context and result statuses', () => {
    expect(FlowAgentInputSchema.parse({ Task: 'Consultar pedidos', Context: 'Cliente atual' })).toEqual({ Task: 'Consultar pedidos', Context: 'Cliente atual' });
    expect(FlowAgentOutputSchema.parse({ Status: 'COMPLETED', Summary: 'Concluído', Results: [{ Action: 'x', Output: { Id: 1 } }], MissingInformation: [] })).toMatchObject({ Status: 'COMPLETED' });
  });

  it('registers the AIDocument Root Agent keys separately from the legacy graph', () => {
    const registry = new AgentRegistry();
    expect(registry.has('chat-orchestrator-poc')).toBe(true);
    expect(registry.hasAIDocument('sales-agent')).toBe(true);
    expect(registry.hasAIDocument('support-agent')).toBe(true);
    expect(registry.hasAIDocument('chat-orchestrator-poc')).toBe(false);
  });
});
