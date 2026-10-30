import { describe, expect, it } from 'vitest';
import { FlowAssistInputSchema } from '../../src/api/contracts/flowAssistInput.js';
import { FlowAssistV2AgentOutputSchema } from '../../src/api/contracts/flowAssistOutput.js';
import { createFlowAssistAgent, flowAssistInputItems } from '../../src/agents/flow-assist/flowAssistAgent.js';
import { validateFlowAssistV2Output } from '../../src/runtime/FlowAssistRuntime.js';
import { flowAssistV2Input, flowAssistOutput } from '../helpers/flowAssist.js';

const output = {
  ...flowAssistOutput,
  NextAgentAssists: [{ Agent: 'flow-assist-agent', Mode: 'CHECK', Instructions: 'Confira a transportadora informada.',
    AfterIdProcessLineFlow: 789, TargetIdProcessLineFlows: [81232] }],
};

describe('Flow Assist v2 contract', () => {
  it('accepts the complete stable step manifest and bounded continuation request', () => {
    expect(FlowAssistInputSchema.parse(flowAssistV2Input)).toEqual(flowAssistV2Input);
    const withZeroStep = {
      ...flowAssistV2Input,
      StepManifest: flowAssistV2Input.StepManifest.map((step, index) => index === 0 ? { ...step, Step: 0 } : step),
    };
    expect(FlowAssistInputSchema.safeParse(withZeroStep).success).toBe(true);
    const item = flowAssistInputItems(flowAssistV2Input)[0];
    const payload = JSON.parse((item as { content: string }).content);
    expect(payload).toMatchObject({ ProtocolVersion: 2, StepManifest: flowAssistV2Input.StepManifest, Continuation: flowAssistV2Input.Continuation });
  });

  it.each([
    { StepManifest: flowAssistV2Input.StepManifest.map((step, index) => index === 0 ? { ...step, Step: -1 } : step) },
    { StepManifest: [...flowAssistV2Input.StepManifest, flowAssistV2Input.StepManifest[0]] },
    { Continuation: { ...flowAssistV2Input.Continuation, CandidateTargets: [99999] } },
    { Continuation: { ...flowAssistV2Input.Continuation, MaxNextAgentAssists: 4 } },
    { ProtocolVersion: 1 },
  ])('rejects malformed v2 input %#', (patch) => {
    expect(FlowAssistInputSchema.safeParse({ ...flowAssistV2Input, ...patch }).success).toBe(false);
  });

  it('returns a v2 response only for authorized anchors, target IDs and budgets', () => {
    expect(FlowAssistV2AgentOutputSchema.parse(output)).toEqual(output);
    expect(validateFlowAssistV2Output(output, flowAssistV2Input)).toEqual(output);
    const invalid = [
      { ...output, NextAgentAssists: [{ ...output.NextAgentAssists[0], Agent: 'sales-agent' }] },
      { ...output, NextAgentAssists: [{ ...output.NextAgentAssists[0], AfterIdProcessLineFlow: 99999 }] },
      { ...output, NextAgentAssists: [{ ...output.NextAgentAssists[0], TargetIdProcessLineFlows: [99999] }] },
      { ...output, NextAgentAssists: [{ ...output.NextAgentAssists[0], TargetIdProcessLineFlows: [789] }] },
    ];
    for (const candidate of invalid) expect(() => validateFlowAssistV2Output(candidate, flowAssistV2Input)).toThrow();
    const disabled = { ...flowAssistV2Input, Continuation: { ...flowAssistV2Input.Continuation, Enabled: false, MaxNextAgentAssists: 0, CandidateTargets: [] } };
    expect(() => validateFlowAssistV2Output(output, disabled)).toThrow();
  });

  it('validates a v2 CHECK result and permits only bounded continuation targets', () => {
    const checkInput = { ...flowAssistV2Input, Mode: 'CHECK' as const,
      Targets: [{ IdProcessLineFlow: 81231, Step: 11, ObjectType: 'PROMPT' as const, Description: 'Cliente',
        ObjectDescription: 'Confirme o cliente.', Resolved: true, CurrentValue: 'Café do Mercado' }],
      Check: { Repair: true } };
    const checkOutput = { Mode: 'CHECK' as const,
      Results: [{ IdProcessLineFlow: 81231, Action: 'KEEP' as const, Value: null, Reason: null }],
      NextAgentAssists: [{ Agent: 'flow-assist-agent', Mode: 'CHECK' as const, Instructions: 'Valide a transportadora.',
        AfterIdProcessLineFlow: 789, TargetIdProcessLineFlows: [81232] }] };
    expect(validateFlowAssistV2Output(checkOutput, checkInput)).toEqual(checkOutput);
    expect(() => validateFlowAssistV2Output({ ...checkOutput, NextAgentAssists: [{ ...checkOutput.NextAgentAssists[0], TargetIdProcessLineFlows: [81234, 81234] }] }, checkInput)).toThrow();
  });

  it('adds continuation guidance and schema only for v2 agents', () => {
    const agent = createFlowAssistAgent({ model: 'test-model', protocolVersion: 2 });
    expect(agent.instructions).toContain('StepManifest');
    expect(JSON.stringify(agent.outputType)).toContain('NextAgentAssists');
    const legacy = createFlowAssistAgent({ model: 'test-model', protocolVersion: 1 });
    expect(legacy.instructions).not.toContain('StepManifest');
    expect(JSON.stringify(legacy.outputType)).not.toContain('NextAgentAssists');
  });
});
