import { describe, expect, it } from 'vitest';
import { z } from 'zod';
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
    expect(FlowAgentOutputSchema.parse({ Status: 'COMPLETED', Summary: 'Concluído', Results: [{ Action: 'x', OutputJSON: '{"Id":1}', Error: null }], MissingInformation: [] })).toMatchObject({ Status: 'COMPLETED' });
    expect(FlowAgentOutputSchema.safeParse({ Status: 'COMPLETED', Summary: 'Inválido', Results: [{ Action: 'x', Output: { Id: 1 }, Error: null }], MissingInformation: [] }).success).toBe(false);
  });

  it('accepts serialized capability outputs for every JSON value shape', () => {
    const values = [{ Id: 1 }, [1, 'two'], 'texto', 42, true, null] as const;
    for (const value of values) {
      const parsed = FlowAgentOutputSchema.parse({
        Status: 'COMPLETED',
        Summary: 'Concluído',
        Results: [{ Action: 'preserve_value', OutputJSON: value === null ? null : JSON.stringify(value), Error: null }],
        MissingInformation: [],
      });
      expect(parsed.Results[0]?.OutputJSON).toBe(value === null ? null : JSON.stringify(value));
    }
  });

  it('emits a concrete structured-output schema without an open unknown field', () => {
    const schema = z.toJSONSchema(FlowAgentOutputSchema) as any;
    const resultItem = schema.properties.Results.items;
    expect(resultItem.properties).not.toHaveProperty('Output');
    expect(resultItem.properties.OutputJSON).toEqual({ type: ['string', 'null'] });
  });

  it('preserves capability errors with null OutputJSON', () => {
    expect(FlowAgentOutputSchema.parse({
      Status: 'FAILED',
      Summary: 'Falha operacional.',
      Results: [{ Action: 'find_customer', OutputJSON: null, Error: { Code: 'FLOW_ERROR', Message: 'Falhou.' } }],
      MissingInformation: [],
    })).toMatchObject({ Results: [{ Action: 'find_customer', OutputJSON: null, Error: { Code: 'FLOW_ERROR' } }] });
  });

  it('registers the AIDocument Root Agent keys separately from the legacy graph', () => {
    const registry = new AgentRegistry();
    expect(registry.has('chat-orchestrator-poc')).toBe(true);
    expect(registry.hasAIDocument('sales-agent')).toBe(true);
    expect(registry.hasAIDocument('support-agent')).toBe(true);
    expect(registry.hasAIDocument('chat-orchestrator-poc')).toBe(false);
  });
});
