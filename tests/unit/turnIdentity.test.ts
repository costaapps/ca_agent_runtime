import { describe, expect, it } from 'vitest';
import { canonicalTurnPayload, hashPreAgentContextTurnPayload, hashTurnPayload } from '../../src/runtime/TurnIdentity.js';

const baseTurn = {
  TurnUUID: '14ed24ea-0000-4000-8000-000000000020',
  Agent: 'sales-agent',
  IdCompany: 1003,
  IdChat: 123,
  IdProcessLine: 456,
  TurnSource: 'MESSAGE' as const,
  Messages: [{ IdMessage: 1, Text: 'Quero comprar' }],
  ProcessContextRevision: 4,
  ProcessContext: { System: {}, Facts: { ProductInterest: 'RAM' }, BusinessReferences: {}, CurrentIntent: {} },
  ActivationContext: null,
};

describe('Agent turn identity', () => {
  it('changes canonical payload and hash when ProcessContext revision changes', () => {
    const changed = { ...baseTurn, ProcessContextRevision: 5 };
    expect(canonicalTurnPayload(changed)).not.toBe(canonicalTurnPayload(baseTurn));
    expect(hashTurnPayload(changed)).not.toBe(hashTurnPayload(baseTurn));
  });

  it('excludes tenant routing fields from the functional idempotency hash', () => {
    const scoped = { ...baseTurn, CompanyUUID: '14ed24ea-0000-4000-8000-000000000001', IdDatabase: 8 };
    const rerouted = { ...scoped, CompanyUUID: 'd2719f62-8a67-4fd5-a6ae-411a6a3ef177', IdDatabase: 19 };
    expect(canonicalTurnPayload(scoped)).not.toContain('CompanyUUID');
    expect(canonicalTurnPayload(scoped)).not.toContain('IdDatabase');
    expect(hashTurnPayload(rerouted)).toBe(hashTurnPayload(scoped));
  });

  it('includes activation source and context in the idempotency payload', () => {
    const activation = {
      ...baseTurn,
      TurnSource: 'ACTIVATION' as const,
      Messages: [],
      ActivationContext: { ActivationUUID: 'activation-20', Source: 'MODULE_COMPLETED' as const, Context: { Summary: 'Concluído' } },
    };
    const payload = canonicalTurnPayload(activation);
    expect(payload).toContain('ACTIVATION');
    expect(payload).toContain('activation-20');
    expect(payload).toContain('MODULE_COMPLETED');
  });

  it('includes AgentConfiguration contract, Revision and Instructions in the turn hash', () => {
    const configured = { ...baseTurn, AgentConfiguration: { Code: 'reception-agent', Revision: 4, Instructions: 'Fale com cordialidade.', Name: 'Recepção' } };
    const changedInstructions = { ...configured, AgentConfiguration: { ...configured.AgentConfiguration, Instructions: 'Outra orientação.' } };
    expect(canonicalTurnPayload(configured)).toContain('Fale com cordialidade.');
    expect(hashTurnPayload(changedInstructions)).not.toBe(hashTurnPayload(configured));
  });

  it('includes AgentContext in the canonical Turn and preserves the pre-context hash for historical replays', () => {
    const mission = { Name: 'Pedido', Objective: 'Montar pedido', Instructions: 'Converse.', CompletionCriteria: ['Pedido criado'] };
    const configured = { ...baseTurn, AgentContext: mission };
    expect(canonicalTurnPayload(configured)).toContain('Montar pedido');
    expect(hashTurnPayload(configured)).not.toBe(hashTurnPayload(baseTurn));
    expect(hashPreAgentContextTurnPayload(configured)).toBe(hashPreAgentContextTurnPayload(baseTurn));
  });
});
