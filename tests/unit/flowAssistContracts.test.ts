import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FlowAssistInputSchema } from '../../src/api/contracts/flowAssistInput.js';
import { FlowAssistAgentOutputSchema, FlowAssistCheckAgentOutputSchema, FlowAssistOutputSchema } from '../../src/api/contracts/flowAssistOutput.js';
import { validateFlowAssistProposals, validateFlowAssistResults } from '../../src/runtime/FlowAssistRuntime.js';
import { KnowledgeConfigurationSchema } from '../../src/api/contracts/knowledgeConfiguration.js';
import { flowAssistCheckInput, flowAssistCheckOutput, flowAssistInput, flowAssistOutput } from '../helpers/flowAssist.js';
import { configuredKnowledge } from '../helpers/knowledgeConfiguration.js';

describe('Flow Assist HTTP and structured output contracts', () => {
  const authorized = KnowledgeConfigurationSchema.parse(configuredKnowledge);

  it('accepts the Core snapshot, all V1 object types, empty instructions and optional Known/ObjectDescription', () => {
    expect(FlowAssistInputSchema.parse(flowAssistInput)).toEqual(flowAssistInput);
    const { Known: _known, ...withoutKnown } = flowAssistInput;
    expect(FlowAssistInputSchema.parse({ ...withoutKnown, Instructions: '', Targets: [{ IdProcessLineFlow: 1, Step: 0, ObjectType: 'PROMPT', Description: '' }] }).Known).toBeUndefined();
    expect(FlowAssistInputSchema.parse({ ...flowAssistInput, Messages: [], Targets: [] }).Targets).toEqual([]);
  });

  it('accepts authorized Knowledge in legacy and explicit PREFILL while keeping the original payload valid', () => {
    const input = { ...flowAssistInput, Instructions: 'Consulte {{knowledge:base:commercial}}.', KnowledgeConfiguration: authorized };
    expect(FlowAssistInputSchema.parse(input)).toEqual(input);
    expect(FlowAssistInputSchema.parse({ ...input, Mode: 'PREFILL' })).toMatchObject({ Mode: 'PREFILL', KnowledgeConfiguration: authorized });
    expect(FlowAssistInputSchema.parse(flowAssistInput)).toEqual(flowAssistInput);
    expect(FlowAssistInputSchema.safeParse({ ...flowAssistInput, Instructions: '', KnowledgeConfiguration: { Version: 1, Connections: [], References: [] } }).success).toBe(true);
  });

  it.each([
    { Instructions: 'Consulte {{knowledge:base:commercial}}.', KnowledgeConfiguration: undefined },
    { Instructions: 'Consulte {{knowledge:base:foreign}}.', KnowledgeConfiguration: authorized },
    { Instructions: 'Consulte {{knowledge:base:commercial', KnowledgeConfiguration: authorized },
  ])('rejects unauthorized or malformed Knowledge in PREFILL: %j', (overrides) => {
    expect(FlowAssistInputSchema.safeParse({ ...flowAssistInput, ...overrides }).success).toBe(false);
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
    { Targets: [{ ...flowAssistInput.Targets[2], Choices: [{ SelectionValue: 'x', Display: 'X' }] }] },
    { Targets: [{ ...flowAssistInput.Targets[0], Choices: [{ SelectionValue: 'x', Display: 'X', Key: 9 }] }] },
    { Targets: [{ ...flowAssistInput.Targets[0], Choices: [
      { SelectionValue: 'duplicate', Display: 'A' }, { SelectionValue: 'duplicate', Display: 'B' },
    ] }] },
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

describe('Flow Assist CHECK contract', () => {
  const authorized = KnowledgeConfigurationSchema.parse(configuredKnowledge);
  const check = { ...flowAssistCheckInput, KnowledgeConfiguration: authorized };

  it('accepts CHECK manifest and authorized Knowledge without changing legacy PREFILL', () => {
    expect(FlowAssistInputSchema.parse(check)).toEqual(check);
    expect(FlowAssistInputSchema.parse({ ...flowAssistInput, Mode: 'PREFILL' }).Mode).toBe('PREFILL');
    expect(FlowAssistInputSchema.parse(flowAssistInput)).toEqual(flowAssistInput);
    expect(FlowAssistInputSchema.safeParse({ ...flowAssistCheckInput, Instructions: '', KnowledgeConfiguration: { Version: 1, Connections: [], References: [] } }).success).toBe(true);
    expect(FlowAssistInputSchema.safeParse({ ...flowAssistCheckInput, KnowledgeConfiguration: undefined }).success).toBe(false);
  });

  it.each([
    { label: 'missing Mode', payload: { ...check, Mode: undefined } },
    { label: 'missing state', payload: { ...check, Targets: [{ ...check.Targets[0], Resolved: undefined }] } },
    { label: 'missing CurrentValue', payload: { ...check, Targets: [{ ...check.Targets[0], CurrentValue: undefined }] } },
    { label: 'missing Repair', payload: { ...check, Check: { Repair: undefined } } },
    { label: 'duplicate targets', payload: { ...check, Targets: [check.Targets[0], check.Targets[0]] } },
    { label: 'technical target field', payload: { ...check, Targets: [{ ...check.Targets[0], Query: 'SQL' }] } },
    { label: 'foreign company reference', payload: { ...check, KnowledgeConfiguration: { ...configuredKnowledge, References: [{ ...configuredKnowledge.References[0], Reference: 'base:other' }] } } },
    { label: 'malformed Knowledge macro', payload: { ...check, Instructions: 'Use {{knowledge:base:commercial' } },
  ])('rejects $label', ({ payload }) => {
    expect(FlowAssistInputSchema.safeParse(payload).success).toBe(false);
  });

  it('compiles the distinct CHECK structured schema and accepts all five actions', () => {
    const output = { Mode: 'CHECK', Results: [
      { IdProcessLineFlow: 81231, Action: 'KEEP', Value: null, Reason: null },
      { IdProcessLineFlow: 81232, Action: 'REPLACE', Value: 'Jadlog', Reason: null },
      { IdProcessLineFlow: 81233, Action: 'SET', Value: 'Jadlog', Reason: null },
    ] };
    expect(validateFlowAssistResults(output, check)).toEqual(output);
    const schema = z.toJSONSchema(FlowAssistCheckAgentOutputSchema);
    expect(schema.type).toBe('object');
    expect(JSON.stringify(schema)).toContain('REPLACE');
    expect(JSON.stringify(schema)).not.toContain('PROPOSED');
    for (const Action of ['MISSING', 'INVALID'] as const) {
      const result = validateFlowAssistResults({ Mode: 'CHECK', Results: [{ IdProcessLineFlow: 81233, Action, Value: null, Reason: 'Informação insuficiente.' }] }, { ...check, Targets: [check.Targets[2]!] });
      expect(result.Results[0]?.Action).toBe(Action);
    }
    expect(FlowAssistOutputSchema.safeParse({ Success: true, ExecutionUUID: '14ed24ea-0000-4000-8000-000000000001', ...output }).success).toBe(true);
    expect(FlowAssistOutputSchema.safeParse({ Success: false, Mode: 'CHECK', Results: [], Error: { Code: 'INVALID_REQUEST', Message: 'Inválido.' } }).success).toBe(true);
  });

  it.each([
    { label: 'KEEP unresolved', output: { ...flowAssistCheckOutput, Results: [{ IdProcessLineFlow: 81233, Action: 'KEEP', Value: null, Reason: null }] }, target: 2 },
    { label: 'SET resolved', output: { ...flowAssistCheckOutput, Results: [{ IdProcessLineFlow: 81231, Action: 'SET', Value: 'X', Reason: null }] }, target: 0 },
    { label: 'REPLACE unresolved', output: { ...flowAssistCheckOutput, Results: [{ IdProcessLineFlow: 81233, Action: 'REPLACE', Value: 'X', Reason: null }] }, target: 2 },
    { label: 'foreign ID', output: { ...flowAssistCheckOutput, Results: [{ IdProcessLineFlow: 999, Action: 'MISSING', Value: null, Reason: null }] }, target: 0 },
  ])('rejects $label', ({ output, target }) => {
    expect(() => validateFlowAssistResults(output, { ...check, Targets: [check.Targets[target]!] })).toThrow(expect.objectContaining({ code: 'INVALID_AGENT_OUTPUT' }));
  });

  it.each([
    { label: 'duplicate ID', Results: [flowAssistCheckOutput.Results[0], flowAssistCheckOutput.Results[0], flowAssistCheckOutput.Results[2]] },
    { label: 'omitted ID', Results: flowAssistCheckOutput.Results.slice(1) },
    { label: 'invented ID', Results: [flowAssistCheckOutput.Results[0], flowAssistCheckOutput.Results[1], { IdProcessLineFlow: 999, Action: 'MISSING', Value: null, Reason: null }] },
    { label: 'SET empty value', Results: [flowAssistCheckOutput.Results[0], flowAssistCheckOutput.Results[1], { IdProcessLineFlow: 81233, Action: 'SET', Value: '  ', Reason: null }] },
    { label: 'KEEP with value', Results: [{ IdProcessLineFlow: 81231, Action: 'KEEP', Value: 'x', Reason: null }, ...flowAssistCheckOutput.Results.slice(1)] },
    { label: 'Reason on SET', Results: [flowAssistCheckOutput.Results[0], flowAssistCheckOutput.Results[1], { IdProcessLineFlow: 81233, Action: 'SET', Value: 'x', Reason: 'secret' }] },
    { label: 'internal ID in Reason', Results: [flowAssistCheckOutput.Results[0], flowAssistCheckOutput.Results[1], { IdProcessLineFlow: 81233, Action: 'MISSING', Value: null, Reason: 'IdCompany 1003' }] },
  ])('rejects $label', ({ Results }) => {
    expect(() => validateFlowAssistResults({ Mode: 'CHECK', Results }, check)).toThrow(expect.objectContaining({ code: 'INVALID_AGENT_OUTPUT' }));
  });

  it.each(['SET', 'REPLACE'] as const)('rejects %s when Repair=false', (Action) => {
    const target = Action === 'SET' ? check.Targets[2]! : check.Targets[1]!;
    const output = { Mode: 'CHECK', Results: [{ IdProcessLineFlow: target.IdProcessLineFlow, Action, Value: 'correção', Reason: null }] };
    expect(() => validateFlowAssistResults(output, { ...check, Check: { Repair: false }, Targets: [target] })).toThrow(expect.objectContaining({ code: 'INVALID_AGENT_OUTPUT' }));
  });
});
