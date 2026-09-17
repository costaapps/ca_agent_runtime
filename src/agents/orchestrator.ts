import { Agent, type JsonSchemaDefinition, type MCPServer } from '@openai/agents';
import type { RuntimeContextData } from '../runtime/RuntimeContext.js';
import type { ExecutionLogger } from '../tracing/ExecutionLogger.js';
import { createHandoffs } from './handoffs.js';
import { createSalesAgent } from './specialists/salesAgent.js';
import { createSupportAgent } from './specialists/supportAgent.js';

export interface AgentGraph {
  root: Agent<RuntimeContextData, any>;
  agents: Agent<RuntimeContextData, any>[];
}

export function createChatOrchestrator(
  outputType: JsonSchemaDefinition,
  mcpServer: MCPServer,
  model: string,
  logger?: ExecutionLogger,
): AgentGraph {
  const salesAgent = createSalesAgent(outputType, mcpServer, model);
  const supportAgent = createSupportAgent(outputType, mcpServer, model);
  const handoffs = createHandoffs(salesAgent, supportAgent, logger);
  const root = new Agent<RuntimeContextData, any>({
    name: 'ChatOrchestrator',
    handoffDescription: 'Orquestrador da conversa que encaminha solicitações para especialistas.',
    model,
    outputType: outputType as any,
    instructions: ({ context }) => [
      'Você é o ChatOrchestrator da Costa Apps.',
      'Interprete a mensagem atual e selecione o especialista adequado usando handoff nativo quando houver especialização clara.',
      'SalesAgent atende intenção comercial, compra e produto. SupportAgent atende suporte, problema e dúvida operacional.',
      'Ao fazer handoff, forneça apenas uma razão operacional curta no campo Reason. Nunca forneça cadeia de raciocínio.',
      `A obrigação final é cumprir ExpectedOutput.Description: ${context.Execution.ExpectedOutput?.Description ?? 'o contrato legado recebido pelo Runtime'}`,
      'Você não possui tools MCP nesta etapa.',
    ].join('\n'),
    handoffs: [...handoffs],
    mcpServers: [],
  });
  return { root, agents: [root, salesAgent, supportAgent] };
}
