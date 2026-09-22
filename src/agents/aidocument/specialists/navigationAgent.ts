import { Agent, type MCPServer } from '@openai/agents';
import { z } from 'zod';
import type { RuntimeContextData } from '../../../runtime/RuntimeContext.js';

export const NavigationAgentInputSchema = z.object({
  Task: z.string().min(1),
  Context: z.string().optional(),
});

const NavigationErrorSchema = z.object({
  Code: z.string(),
  Message: z.string(),
}).nullable();

export const NavigationAgentOutputSchema = z.object({
  Status: z.enum(['HANDOFF_REQUESTED', 'NEEDS_CLARIFICATION', 'NO_MATCH', 'FAILED']),
  Summary: z.string(),
  Destination: z.string().nullable(),
  Clarification: z.string().nullable(),
  Error: NavigationErrorSchema,
});

export type NavigationAgentOutput = z.infer<typeof NavigationAgentOutputSchema>;

function processContextForPrompt(context: RuntimeContextData): string {
  return JSON.stringify(context.ProcessContext ?? { System: {}, Facts: {}, BusinessReferences: {}, CurrentIntent: {} });
}

export function createNavigationAgent(mcpServer: MCPServer, model: string, runtimeContext: RuntimeContextData): Agent<RuntimeContextData, typeof NavigationAgentOutputSchema> {
  return new Agent<RuntimeContextData, typeof NavigationAgentOutputSchema>({
    name: 'NavigationAgent',
    handoffDescription: 'Especialista que encontra destinos autorizados e solicita navegação do Process.',
    model,
    outputType: NavigationAgentOutputSchema,
    instructions: [
      'Você é o NavigationAgent, um especialista interno de navegação da Agent Platform.',
      'Você não é Root Agent, não é owner de ProcessLine e não conversa diretamente com o cliente.',
      'Sua única responsabilidade é decidir se a necessidade deve continuar no owner atual ou ser encaminhada para um destino autorizado.',
      'Use exclusivamente list_navigation_destinations para descobrir destinos autorizados e request_handoff para solicitar um Handoff.',
      'Nunca chame Flow tools e nunca tente aplicar, fechar ou criar ProcessLine.',
      'Nunca invente destinos, DestinationRef ou IDs técnicos. Só envie a request_handoff com um DestinationRef retornado pela list_navigation_destinations.',
      'Match inequívoco: solicite request_handoff e retorne HANDOFF_REQUESTED. Mais de um destino plausível: retorne NEEDS_CLARIFICATION com uma única pergunta objetiva. Nenhum destino compatível: retorne NO_MATCH.',
      'Não use score percentual de confiança e não exponha DestinationRef ao Root ou ao cliente.',
      'O ProcessContext abaixo é readonly e serve para continuidade operacional. Não o altere, não o exponha e não trate ausência de dado como negativa.',
      `ProcessContext View: ${processContextForPrompt(runtimeContext)}`,
      'Reason e Summary devem ser justificativas operacionais curtas, sem cadeia de raciocínio.',
      'Produza somente o schema estruturado NavigationAgentOutput.',
    ].join('\n'),
    mcpServers: [mcpServer],
    mcpConfig: { convertSchemasToStrict: true },
  });
}

export function createNavigationAgentTool(navigationAgent: Agent<RuntimeContextData, typeof NavigationAgentOutputSchema>) {
  return navigationAgent.asTool({
    toolName: 'use_navigation',
    toolDescription: 'Delega ao NavigationAgent a decisão de destino e eventual solicitação de Handoff. Informe Task e, opcionalmente, fatos relevantes em Context; nunca informe DestinationRef ou IDs técnicos.',
    parameters: NavigationAgentInputSchema,
    inputBuilder: ({ params }) => [
      {
        role: 'user',
        content: `Task: ${params.Task}${params.Context ? `\nContext: ${params.Context}` : ''}`,
      },
    ],
    customOutputExtractor: ({ finalOutput }) => JSON.stringify(finalOutput),
  });
}
