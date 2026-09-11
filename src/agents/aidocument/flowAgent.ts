import { Agent, type MCPServer } from '@openai/agents';
import { z } from 'zod';
import type { RuntimeContextData } from '../../runtime/RuntimeContext.js';

export const FlowAgentInputSchema = z.object({
  Task: z.string().min(1),
  Context: z.string().optional(),
});

const FlowResultSchema = z.object({
  Action: z.string(),
  Output: z.unknown().nullable(),
  Error: z.object({ Code: z.string(), Message: z.string() }).optional(),
});

export const FlowAgentOutputSchema = z.object({
  Status: z.enum(['COMPLETED', 'NEEDS_INPUT', 'NOT_AVAILABLE', 'FAILED']),
  Summary: z.string(),
  Results: z.array(FlowResultSchema),
  MissingInformation: z.array(z.string()),
});

export type FlowAgentOutput = z.infer<typeof FlowAgentOutputSchema>;

export function createFlowAgent(mcpServer: MCPServer, model: string): Agent<RuntimeContextData, typeof FlowAgentOutputSchema> {
  return new Agent<RuntimeContextData, typeof FlowAgentOutputSchema>({
    name: 'FlowAgent',
    handoffDescription: 'Agente técnico que descobre e executa capabilities publicadas do AIDocument.',
    model,
    outputType: FlowAgentOutputSchema,
    instructions: [
      'Você é o FlowAgent técnico do AIDocument. Você nunca conversa diretamente com o usuário e nunca solicita encerramento da sessão.',
      'Receba uma Task e um Contexto opcional. Não peça ao agente pai IDs técnicos, Action ou IdProcessLineFlow.',
      'Para cumprir a tarefa, siga o fluxo: chame list_flow_actions; escolha uma Action somente entre as retornadas; chame describe_flow_action; valide os RequiredInputs; então chame execute_flow_action.',
      'Uma Task pode exigir zero, uma ou várias capabilities. Repita list/describe/execute quando necessário, sem inventar Action.',
      'Preserve exatamente o Output de negócio retornado por execute_flow_action em Results[].Output. Não inclua Invocation metadata no Output funcional.',
      'Se faltar dado para RequiredInputs, retorne NEEDS_INPUT e liste MissingInformation. Se a capability não estiver disponível, retorne NOT_AVAILABLE. Se a execução falhar, retorne FAILED e preserve Code/Message em Results[].Error.',
      'Erros retornados pelas Flow tools são resultados operacionais interpretáveis, não motivo para encerrar automaticamente o Turn.',
      'Produza somente o schema estruturado FlowAgentOutput.',
    ].join('\n'),
    mcpServers: [mcpServer],
    mcpConfig: { convertSchemasToStrict: true },
  });
}

export function createFlowAgentTool(flowAgent: Agent<RuntimeContextData, typeof FlowAgentOutputSchema>) {
  return flowAgent.asTool({
    toolName: 'use_flow_capabilities',
    toolDescription: 'Delega uma tarefa de negócio ao FlowAgent. Informe Task e, opcionalmente, fatos em Context; não informe Action nem IDs técnicos.',
    parameters: FlowAgentInputSchema,
    inputBuilder: ({ params }) => [
      { role: 'user', content: `Task: ${params.Task}${params.Context ? `\nContext: ${params.Context}` : ''}` },
    ],
    customOutputExtractor: ({ finalOutput }) => JSON.stringify(finalOutput),
  });
}
