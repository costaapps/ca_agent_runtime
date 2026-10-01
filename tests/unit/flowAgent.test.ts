import { describe, expect, it } from 'vitest';
import { createFlowAgent } from '../../src/agents/aidocument/specialists/flowAgent.js';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';

describe('FlowAgent capability instructions', () => {
  const agent = createFlowAgent(createFakeMcpServer(), 'test-model');
  const instructions = agent.instructions as string;

  it('combines capability description, semantic guidance and required inputs before execution', () => {
    expect(instructions).toContain('Description + ObjectDescription + RequiredInputs');
    expect(instructions).toContain('orientação semântica específica daquela etapa');
    expect(instructions).toContain('Input.Value quando requerido');
    expect(instructions.indexOf('describe_flow_action')).toBeLessThan(instructions.indexOf('execute_flow_action'));
  });

  it('supports absent, null or empty guidance without business validators or schemas', () => {
    expect(instructions).toContain('ausente, nulo ou vazio');
    expect(instructions).toContain('sem criar regras determinísticas no Runtime');
    expect(instructions).toContain('Não introduza DataType, InputSchema, ResolutionSchema ou ExpectedFormat');
    expect(instructions).toContain('responsabilidades exclusivas do Core');
  });

  it('limits the guidance to capability input and preserves platform and output invariants', () => {
    expect(instructions).toContain('não substitui as regras técnicas do FlowAgent');
    expect(instructions).toContain('as tools autorizadas nem os contratos da plataforma');
    expect(instructions).toContain('Preserve exatamente o Output de negócio');
    expect(agent.mcpServers).toHaveLength(1);
    expect(agent.tools).toEqual([]);
  });
});
