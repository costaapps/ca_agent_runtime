import { Agent, type MCPServer } from '@openai/agents';
import type { ExecutionLogger } from '../../tracing/ExecutionLogger.js';
import type { RuntimeContextData } from '../../runtime/RuntimeContext.js';
import { AIDocumentRootOutputSchema } from '../../api/contracts/agentTurnOutput.js';
import { createFlowAgent, createFlowAgentTool } from './flowAgent.js';

export interface AIDocumentAgentGraph {
  root: Agent<RuntimeContextData, typeof AIDocumentRootOutputSchema>;
  agents: Agent<RuntimeContextData, any>[];
}

function createRootInstructions(role: 'sales' | 'support'): string {
  const specialization = role === 'sales'
    ? 'Atenda intenção comercial, compra, produto e negociação.'
    : 'Atenda suporte, problemas e dúvidas operacionais.';
  return [
    `Você é o Root Agent ${role === 'sales' ? 'SalesAgent' : 'SupportAgent'} do AIDocument Costa Apps.`,
    specialization,
    'Você é o dono da conversa e deve produzir a resposta ao usuário no campo Response.',
    'Use a memória persistente da Session fornecida pelo Runtime; não monte histórico manualmente e não use get_chat_history como substituto da Session.',
    'Quando uma tarefa exigir capabilities de negócio publicadas no AIDocument, chame use_flow_capabilities com uma Task clara e Context contendo fatos úteis. Não escolha Action e não transmita IDs técnicos.',
    'Interprete o resultado do FlowAgent. Se retornar NEEDS_INPUT, pergunte ao usuário somente a informação faltante. Se retornar FAILED ou NOT_AVAILABLE, explique a situação sem inventar dados.',
    'Results[].OutputJSON contém a serialização JSON integral do Output original da capability; interprete esse JSON sem esperar um campo Output estruturado diferente e sem inventar ou alterar dados.',
    'Não invente dados de negócio, preços, disponibilidade, resultados de capabilities ou memória anterior.',
    'CompletionRequested é apenas um pedido ao Core. Só use true quando a conversa indicar que o AIDocument deve ser encerrado e sempre informe uma Reason operacional curta; o Runtime nunca fecha a Session sozinho.',
    'FlowAgent não conversa diretamente com o usuário. Você deve transformar seus resultados em Response.',
    'Produza somente o schema fixo Response + Control.',
  ].join('\n');
}

export function createAIDocumentRootAgent(
  name: 'SalesAgent' | 'SupportAgent',
  mcpServer: MCPServer,
  model: string,
): AIDocumentAgentGraph {
  const role = name === 'SalesAgent' ? 'sales' : 'support';
  const flowAgent = createFlowAgent(mcpServer, model);
  const root = new Agent<RuntimeContextData, typeof AIDocumentRootOutputSchema>({
    name,
    handoffDescription: role === 'sales'
      ? 'Root Agent para conversas comerciais do AIDocument.'
      : 'Root Agent para conversas de suporte do AIDocument.',
    model,
    outputType: AIDocumentRootOutputSchema,
    instructions: createRootInstructions(role),
    tools: [createFlowAgentTool(flowAgent)],
    mcpServers: [mcpServer],
    mcpConfig: { convertSchemasToStrict: true },
  });
  return { root, agents: [root, flowAgent] };
}

export function attachAIDocumentLifecycleLogging(graph: AIDocumentAgentGraph, logger: ExecutionLogger): void {
  for (const agent of graph.agents) {
    agent.on('agent_start', (_context, startedAgent) => {
      void logger.agentStart(startedAgent.name).catch(() => undefined);
    });
  }
}
