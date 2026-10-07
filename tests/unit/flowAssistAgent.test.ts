import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { createFlowAssistAgent, FLOW_ASSIST_AGENT_INSTRUCTIONS, flowAssistInputItems } from '../../src/agents/flow-assist/flowAssistAgent.js';
import { FlowAssistAgentOutputSchema } from '../../src/api/contracts/flowAssistOutput.js';
import { flowAssistInput } from '../helpers/flowAssist.js';
import { flowAssistCheckInput } from '../helpers/flowAssist.js';
import { KnowledgeConfigurationSchema } from '../../src/api/contracts/knowledgeConfiguration.js';
import { configuredKnowledge } from '../helpers/knowledgeConfiguration.js';
import { KnowledgeSearchService } from '../../src/knowledge/KnowledgeSearchService.js';
import { EnvironmentProviderCredentialResolver } from '../../src/knowledge/credentials/EnvironmentProviderCredentialResolver.js';
import { AGENT_PLATFORM_KNOWLEDGE_TECHNICAL_INSTRUCTIONS } from '../../src/knowledge/knowledgeTechnicalInstructions.js';
import { createRuntimeContext } from '../../src/runtime/RuntimeContext.js';
import { FLOW_ASSIST_CHECK_INSTRUCTIONS } from '../../src/agents/flow-assist/flowAssistAgent.js';
import { FlowAssistCheckAgentOutputSchema } from '../../src/api/contracts/flowAssistOutput.js';

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
    for (const rule of ['Messages e Known', 'somente os Targets', 'exatamente uma proposta', 'Description informa', 'ObjectDescription define', 'nunca as substitui', 'UNKNOWN e Value=null', 'PROPOSED exige Value textual não vazio; nunca retorne string vazia ou apenas espaços.', 'CFL.Key', 'Não converse', 'não peça esclarecimentos', 'chain-of-thought', 'confidence', 'somente o Core valida']) {
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

  it('builds stateless CHECK with only the authorized native Knowledge tool', () => {
    const service = new KnowledgeSearchService({ search: async () => [] }, new EnvironmentProviderCredentialResolver({ OPENAI_API_KEY: 'test-key' }));
    const runtimeContext = createRuntimeContext({ Agent: 'chat-orchestrator-poc', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789, Message: '', ExpectedOutput: { Name: 'X', Description: 'X' } }, 'execution');
    const configuration = KnowledgeConfigurationSchema.parse(configuredKnowledge);
    const check = createFlowAssistAgent({ model: 'test-model', mode: 'CHECK', runtimeContext, knowledgeConfiguration: configuration, knowledgeSearchService: service });
    expect(check.outputType).toBe(FlowAssistCheckAgentOutputSchema);
    expect(check.tools.map((entry) => entry.name)).toEqual(['search_knowledge']);
    expect(check.mcpServers).toEqual([]);
    expect(check.handoffs).toEqual([]);
    expect(check.instructions).toContain(AGENT_PLATFORM_KNOWLEDGE_TECHNICAL_INSTRUCTIONS);
    expect(check.instructions).toContain('base:commercial');
    expect(check.instructions).not.toContain('vs_secret');
    const empty = createFlowAssistAgent({ model: 'test-model', mode: 'CHECK', runtimeContext, knowledgeConfiguration: { Version: 1, Connections: [], References: [] }, knowledgeSearchService: service });
    expect(empty.tools).toEqual([]);
    expect(FLOW_ASSIST_CHECK_INSTRUCTIONS).toContain('NO_RESULTS');
    expect(FLOW_ASSIST_CHECK_INSTRUCTIONS).toContain('somente o Core decide PASS/BLOCK');
  });

  it('offers search_knowledge in PREFILL only when References are authorized', () => {
    const service = new KnowledgeSearchService({ search: async () => [] }, new EnvironmentProviderCredentialResolver({ OPENAI_API_KEY: 'test-key' }));
    const runtimeContext = createRuntimeContext({ Agent: 'chat-orchestrator-poc', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789, Message: '', ExpectedOutput: { Name: 'X', Description: 'X' } }, 'execution');
    const knowledgeConfiguration = KnowledgeConfigurationSchema.parse(configuredKnowledge);
    for (const mode of [undefined, 'PREFILL' as const]) {
      const agent = createFlowAssistAgent({ model: 'test-model', mode, runtimeContext, knowledgeConfiguration, knowledgeSearchService: service });
      expect(agent.outputType).toBe(FlowAssistAgentOutputSchema);
      expect(agent.tools.map((entry) => entry.name)).toEqual(['search_knowledge']);
      expect(agent.mcpServers).toEqual([]);
      expect(agent.handoffs).toEqual([]);
      expect(agent.instructions).toContain(AGENT_PLATFORM_KNOWLEDGE_TECHNICAL_INSTRUCTIONS);
      expect(agent.instructions).toContain('somente search_knowledge');
      expect(agent.instructions).not.toContain('Você não possui tools, MCP, Knowledge');
      expect(agent.instructions).not.toContain('vs_secret');
    }
    const empty = createFlowAssistAgent({ model: 'test-model', mode: 'PREFILL', runtimeContext, knowledgeConfiguration: { Version: 1, Connections: [], References: [] }, knowledgeSearchService: service });
    expect(empty.tools).toEqual([]);
    expect(empty.instructions).toBe(FLOW_ASSIST_AGENT_INSTRUCTIONS);
  });

  it('sends CHECK state and policy to the model without leaking Knowledge credentials', () => {
    const payload = JSON.parse((flowAssistInputItems({ ...flowAssistCheckInput, KnowledgeConfiguration: KnowledgeConfigurationSchema.parse(configuredKnowledge) })[0] as { content: string }).content);
    expect(payload).toMatchObject({ Mode: 'CHECK', Check: { Repair: true } });
    expect(payload.Targets[0]).toMatchObject({ Resolved: true, CurrentValue: 'Café do Mercado' });
    expect(JSON.stringify(payload)).not.toMatch(/OPENAI_API_KEY|vs_secret|file_secret/);
  });
});
