import { describe, expect, it } from 'vitest';
import { AgentTurnInputSchema } from '../../src/api/contracts/agentTurnInput.js';
import { KnowledgeConfigurationSchema, effectiveKnowledgeConfiguration } from '../../src/api/contracts/knowledgeConfiguration.js';
import { canonicalTurnPayload, hashPreKnowledgeTurnPayload, hashTurnPayload } from '../../src/runtime/TurnIdentity.js';
import { configuredKnowledge } from '../helpers/knowledgeConfiguration.js';

const turn = {
  TurnUUID: '14ed24ea-0000-4000-8000-000000000600', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123,
  IdProcessLine: 456, Messages: [{ IdMessage: 600, Text: 'Política de devolução?' }],
};
const connection = configuredKnowledge.Connections[0]!;
const base = configuredKnowledge.References[0]!;
const document = configuredKnowledge.References[1]!;

describe('KnowledgeConfiguration contract', () => {
  it('accepts absent and empty Knowledge as equivalent runtime configurations', () => {
    const parsed = AgentTurnInputSchema.parse(turn);
    expect(parsed.KnowledgeConfiguration).toBeUndefined();
    expect(effectiveKnowledgeConfiguration(parsed.KnowledgeConfiguration)).toEqual({ Version: 1, Connections: [], References: [] });
    expect(AgentTurnInputSchema.parse({ ...turn, KnowledgeConfiguration: { Version: 1, Connections: [], References: [] } }).KnowledgeConfiguration).toEqual(effectiveKnowledgeConfiguration(undefined));
  });

  it('validates the Core contract and rejects unrecognized, malformed or unsafe fields', () => {
    expect(AgentTurnInputSchema.safeParse({ ...turn, KnowledgeConfiguration: configuredKnowledge }).success).toBe(true);
    for (const invalid of [
      { ...configuredKnowledge, Version: 2 },
      { ...configuredKnowledge, APIKey: 'secret' },
      { ...configuredKnowledge, Connections: [{ ...connection, APIKey: 'secret' }] },
      { ...configuredKnowledge, References: [{ ...base, IdCompany: 1003 }] },
      { ...configuredKnowledge, References: [{ ...document, Filter: null }] },
      { ...configuredKnowledge, References: [{ ...base, Filter: document.Filter }] },
      { ...configuredKnowledge, References: [{ ...document, SearchOptions: { MaxResults: 0 } }] },
      { ...configuredKnowledge, References: [{ ...document, SearchOptions: { ScoreThreshold: 1.1 } }] },
      { ...configuredKnowledge, References: [{ ...base, ConnectionCode: 'missing' }] },
      { ...configuredKnowledge, References: [base, base] },
    ]) {
      expect(KnowledgeConfigurationSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('supports compound document filters and blocks invalid selector types', () => {
    expect(KnowledgeConfigurationSchema.safeParse({ ...configuredKnowledge, References: [{ ...document, Filter: { type: 'and', filters: [document.Filter, { type: 'in', key: 'year', value: [2025, 2026] }] } }] }).success).toBe(true);
    expect(KnowledgeConfigurationSchema.safeParse({ ...configuredKnowledge, References: [{ ...document, Filter: { type: 'inject', key: 'x', value: 'y' } }] }).success).toBe(false);
  });

  it('includes Knowledge in the new hash while preserving both historical hash formats', () => {
    const parsed = AgentTurnInputSchema.parse({ ...turn, KnowledgeConfiguration: configuredKnowledge });
    expect(canonicalTurnPayload(parsed)).toContain('document:commercial/refund-policy');
    expect(hashTurnPayload(parsed)).not.toBe(hashTurnPayload({ ...parsed, KnowledgeConfiguration: { Version: 1, Connections: [], References: [] } }));
    expect(hashPreKnowledgeTurnPayload(parsed)).toBe(hashPreKnowledgeTurnPayload({ ...parsed, KnowledgeConfiguration: undefined }));
    expect(hashTurnPayload(turn)).not.toBe(hashPreKnowledgeTurnPayload(turn));
  });
});
