import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { createFlowAssistAgent, FLOW_ASSIST_AGENT_INSTRUCTIONS, flowAssistInputItems } from '../../src/agents/flow-assist/flowAssistAgent.js';
import { FlowAssistAgentOutputSchema } from '../../src/api/contracts/flowAssistOutput.js';
import { flowAssistInput } from '../helpers/flowAssist.js';

describe('dedicated stateless Flow Assist agent', () => {
  it('has fixed output and no MCP, tools, handoffs, Flow/Navigation/Knowledge capabilities', () => {
    const agent = createFlowAssistAgent('test-model');
    expect(agent.tools).toEqual([]);
    expect(agent.mcpServers).toEqual([]);
    expect(agent.handoffs).toEqual([]);
    expect(agent.outputType).toBe(FlowAssistAgentOutputSchema);
    expect(agent.name).toBe('FlowAssistAgent');
  });

  it('is registered only in the short stateless execution category', () => {
    const registry = new AgentRegistry();
    expect(registry.hasFlowAssist('flow-assist-agent')).toBe(true);
    expect(registry.has('flow-assist-agent')).toBe(false);
    expect(registry.hasHostedAgent('flow-assist-agent')).toBe(false);
    expect(registry.buildFlowAssist('flow-assist-agent', 'test-model').name).toBe('FlowAssistAgent');
    expect(() => registry.buildFlowAssist('sales-agent', 'test-model')).toThrow('não encontrado');
  });

  it('enforces evidence, manifest cardinality, semantic guidance and platform boundaries', () => {
    for (const rule of ['Messages e Known', 'somente os Targets', 'exatamente uma proposta', 'Description informa', 'ObjectDescription orienta', 'nunca as substitui', 'UNKNOWN e Value=null', 'PROPOSED exige Value textual não vazio; nunca retorne string vazia ou apenas espaços.', 'CFL.Key', 'Não converse', 'não peça esclarecimentos', 'chain-of-thought', 'confidence', 'somente o Core valida']) {
      expect(FLOW_ASSIST_AGENT_INSTRUCTIONS).toContain(rule);
    }
  });

  it('transports the chronological Core snapshot without session history or invocation IDs in the prompt', () => {
    const items = flowAssistInputItems(flowAssistInput);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ role: 'system' });
    const data = JSON.parse((items[0] as { content: string }).content);
    expect(data).toEqual({ RuntimeEvent: 'FLOW_ASSIST', Instructions: flowAssistInput.Instructions, Messages: flowAssistInput.Messages, Targets: flowAssistInput.Targets, Known: flowAssistInput.Known });
    expect(data.IdCompany).toBeUndefined();
    expect(data.IdProcessLine).toBeUndefined();
    expect(data.SessionUUID).toBeUndefined();
    expect(JSON.parse((flowAssistInputItems({ ...flowAssistInput, Known: undefined })[0] as { content: string }).content).Known).toEqual([]);
  });

  it('distinguishes factual evidence from authorized generation without executing the generated text', () => {
    for (const rule of ['fonte de fatos', 'Instructions, Description e ObjectDescription', 'não precisa existir literalmente', 'sintetizado, formatado, convertido ou gerado', 'não introduza fatos externos', 'somente quando faltar informação factual necessária', 'Não retorne UNKNOWN apenas porque', 'SQL, SELECT, HTML', 'Nunca execute esse conteúdo', 'Não invente schemas', 'empresa, parceiro, período, banco ou ano']) {
      expect(FLOW_ASSIST_AGENT_INSTRUCTIONS).toContain(rule);
    }
    expect(FLOW_ASSIST_AGENT_INSTRUCTIONS).not.toContain('Se não houver evidência suficiente');
  });
});
