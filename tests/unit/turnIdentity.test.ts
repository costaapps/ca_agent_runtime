import { describe, expect, it } from 'vitest';
import { canonicalTurnPayload, hashTurnPayload } from '../../src/runtime/TurnIdentity.js';

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
});
