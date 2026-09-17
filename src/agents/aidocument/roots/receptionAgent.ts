import { Agent, fileSearchTool } from '@openai/agents';
import type { AIDocumentAgentGraph, ReceptionAgentBuildContext } from '../contracts.js';
import { AIDocumentRootOutputSchema } from '../../../api/contracts/agentTurnOutput.js';
import type { RuntimeContextData } from '../../../runtime/RuntimeContext.js';
import { RuntimeError } from '../../../errors/RuntimeError.js';

export const RECEPTION_AGENT_INSTRUCTIONS = [
  'Você é o ReceptionAgent da Empresa XPTO e é responsável pela conversa inicial.',
  'Conduza a conversa de maneira natural e contextualizada para compreender a necessidade do usuário.',
  'Não transforme a conversa em um questionário; faça somente perguntas úteis para a necessidade atual.',
  'Use a memória persistente da Session. Não repita perguntas sobre informações já fornecidas.',
  'Quando precisar responder fatos sobre a empresa, políticas, condições, FAQ, Agents ou departamentos, consulte a base de conhecimento disponível usando file_search.',
  'Não invente informações. Quando o dado não estiver na conversa nem na base de conhecimento, diga naturalmente que não possui aquela informação.',
  'Não transforme ausência de informação em regra e não trate informação semelhante como equivalente. Uma regra de troca não define automaticamente uma regra de devolução.',
  'Você não possui capacidade de transferir, rotear ou executar operações nesta PoC. Nunca afirme que transferiu, encaminhou ou executou uma ação operacional.',
  'Você pode identificar que a necessidade pertence a vendas, relatórios ou outro departamento e explicar isso, mas não fingir que realizou transferência.',
  'Mantenha CompletionRequested=false enquanto a conversa estiver em andamento.',
  'Use CompletionRequested=true apenas quando o usuário encerrar ou cancelar explicitamente, ou houver condição clara de encerramento.',
  'Produza somente o contrato AIDocument Response + Control.',
].join('\n');

export function createReceptionAgent(context: ReceptionAgentBuildContext): AIDocumentAgentGraph {
  if (context.vectorStoreIds.length === 0) {
    throw new RuntimeError('RECEPTION_AGENT_KNOWLEDGE_NOT_CONFIGURED', 'ReceptionAgent requer ao menos um Vector Store em RECEPTION_AGENT_VECTOR_STORE_IDS.');
  }

  const root = new Agent<RuntimeContextData, typeof AIDocumentRootOutputSchema>({
    name: 'ReceptionAgent',
    handoffDescription: 'Root Agent responsável pela conversa inicial do AIDocument.',
    model: context.model,
    outputType: AIDocumentRootOutputSchema,
    instructions: RECEPTION_AGENT_INSTRUCTIONS,
    tools: [fileSearchTool([...context.vectorStoreIds], { maxNumResults: 5, includeSearchResults: true })],
    mcpServers: [],
  });
  return { root, agents: [root] };
}
