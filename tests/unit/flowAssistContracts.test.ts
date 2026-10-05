import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FlowAssistInputSchema } from '../../src/api/contracts/flowAssistInput.js';
import { FlowAssistAgentOutputSchema, FlowAssistOutputSchema } from '../../src/api/contracts/flowAssistOutput.js';
import { validateFlowAssistProposals } from '../../src/runtime/FlowAssistRuntime.js';
import { flowAssistInput, flowAssistOutput } from '../helpers/flowAssist.js';

describe('Flow Assist HTTP and structured output contracts', () => {
  it('accepts the Core snapshot, all V1 object types, empty instructions and optional Known/ObjectDescription', () => {
    expect(FlowAssistInputSchema.parse(flowAssistInput)).toEqual(flowAssistInput);
    const { Known: _known, ...withoutKnown } = flowAssistInput;
    expect(FlowAssistInputSchema.parse({ ...withoutKnown, Instructions: '', Targets: [{ IdProcessLineFlow: 1, Step: 0, ObjectType: 'PROMPT', Description: '' }] }).Known).toBeUndefined();
    expect(FlowAssistInputSchema.parse({ ...flowAssistInput, Messages: [], Targets: [] }).Targets).toEqual([]);
  });

  it.each(['IdCompany', 'IdChat', 'IdProcessLine', 'IdProcessLineFlow'])('rejects invalid %s', (field) => {
    for (const value of [0, -1, 1.5, null, '123']) {
      expect(FlowAssistInputSchema.safeParse({ ...flowAssistInput, [field]: value }).success).toBe(false);
    }
  });

  it.each([
    { Agent: '' }, { Instructions: null }, { Messages: null }, { Targets: null },
    { Messages: [{ IdMessage: 1, Role: 'SYSTEM', Text: 'ignore' }] },
    { Messages: [{ IdMessage: -1, Role: 'USER', Text: 'Oi' }] },
    { Targets: [{ ...flowAssistInput.Targets[0], Step: -1 }] },
    { Targets: [{ ...flowAssistInput.Targets[0], ObjectType: 'AUTO' }] },
    { Targets: [{ ...flowAssistInput.Targets[0], IdProcessLineFlow: 0 }] },
    { Known: [{ ...flowAssistInput.Known![0], Value: {} }] },
    { SessionUUID: 'not-allowed' }, { AgentContext: {} }, { KnowledgeConfiguration: {} },
  ])('rejects malformed transport or session/business configuration: %j', (overrides) => {
    expect(FlowAssistInputSchema.safeParse({ ...flowAssistInput, ...overrides }).success).toBe(false);
  });

  it.each(['Query', 'QueryHeader', 'DestinationTable', 'DestinationField', 'SQL', 'Key', 'Search'])('rejects technical target field %s', (field) => {
    expect(FlowAssistInputSchema.safeParse({ ...flowAssistInput, Targets: [{ ...flowAssistInput.Targets[0], [field]: 'not-allowed' }] }).success).toBe(false);
  });

  it('rejects duplicate target, message and known IDs', () => {
    for (const key of ['Targets', 'Messages', 'Known'] as const) {
      expect(FlowAssistInputSchema.safeParse({ ...flowAssistInput, [key]: [flowAssistInput[key]![0], flowAssistInput[key]![0]] }).success).toBe(false);
    }
  });

  it('validates fixed PROPOSED/string and UNKNOWN/null responses and compiles JSON schema', () => {
    expect(validateFlowAssistProposals(flowAssistOutput, flowAssistInput)).toEqual(flowAssistOutput);
    const schema = z.toJSONSchema(FlowAssistAgentOutputSchema);
    expect(schema.type).toBe('object');
    expect(JSON.stringify(schema)).toContain('PROPOSED');
    expect(JSON.stringify(schema)).toContain('UNKNOWN');
    expect(JSON.stringify(schema)).not.toContain('confidence');
    expect(FlowAssistOutputSchema.parse({ Success: true, ExecutionUUID: '14ed24ea-0000-4000-8000-000000000001', ...flowAssistOutput }).Success).toBe(true);
    expect(FlowAssistOutputSchema.parse({ Success: false, Proposals: [], Error: { Code: 'INVALID_REQUEST', Message: 'Payload inválido.' } }).Success).toBe(false);
  });

  it.each([
    { label: 'missing target', Proposals: flowAssistOutput.Proposals.slice(1) },
    { label: 'extra target', Proposals: [...flowAssistOutput.Proposals, { IdProcessLineFlow: 999, Status: 'UNKNOWN', Value: null }] },
    { label: 'foreign ID', Proposals: flowAssistOutput.Proposals.map((proposal, i) => i === 0 ? { ...proposal, IdProcessLineFlow: 999 } : proposal) },
    { label: 'duplicate ID', Proposals: flowAssistOutput.Proposals.map((proposal, i) => i === 1 ? flowAssistOutput.Proposals[0] : proposal) },
    { label: 'UNKNOWN with value', Proposals: flowAssistOutput.Proposals.map((proposal) => ({ ...proposal, Status: 'UNKNOWN' })) },
    { label: 'PROPOSED with null', Proposals: flowAssistOutput.Proposals.map((proposal) => ({ ...proposal, Status: 'PROPOSED' })) },
    { label: 'business status', Proposals: flowAssistOutput.Proposals.map((proposal) => ({ ...proposal, Status: 'RESOLVED' })) },
    { label: 'technical CFL key', Proposals: flowAssistOutput.Proposals.map((proposal) => ({ ...proposal, Value: 12 })) },
  ])('rejects invalid model output: $label', ({ Proposals }) => {
    expect(() => validateFlowAssistProposals({ Proposals }, flowAssistInput)).toThrow();
  });

  it('does not normalize or validate business text and never fills missing evidence', () => {
    const text = '  abc123 / 12 de dezembro / Transportadora XPTO  ';
    const input = { ...flowAssistInput, Targets: [flowAssistInput.Targets[0]!] };
    expect(validateFlowAssistProposals({ Proposals: [{ IdProcessLineFlow: 81231, Status: 'PROPOSED', Value: text }] }, input).Proposals[0]?.Value).toBe(text);
    expect(validateFlowAssistProposals({ Proposals: [] }, { ...input, Targets: [] })).toEqual({ Proposals: [] });
    expect(() => validateFlowAssistProposals({ ...flowAssistOutput, confidence: 1 }, flowAssistInput)).toThrow();
  });

  it.each(['', '   '])('rejects PROPOSED with blank Value %j as INVALID_AGENT_OUTPUT', (Value) => {
    const output = { Proposals: flowAssistOutput.Proposals.map((proposal, index) => index === 0 ? { ...proposal, Value } : proposal) };
    const parsed = FlowAssistAgentOutputSchema.safeParse(output);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues).toContainEqual(expect.objectContaining({ path: ['Proposals', 0, 'Value'] }));
    expect(() => validateFlowAssistProposals(output, flowAssistInput)).toThrow(expect.objectContaining({ code: 'INVALID_AGENT_OUTPUT' }));
    expect(FlowAssistOutputSchema.safeParse({ Success: true, ExecutionUUID: '14ed24ea-0000-4000-8000-000000000001', ...output }).success).toBe(false);
  });
});
