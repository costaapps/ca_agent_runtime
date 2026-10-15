import { Agent, type MCPServer } from '@openai/agents';
import { z } from 'zod';
import type { RuntimeContextData } from '../../../runtime/RuntimeContext.js';

export const FlowAgentInputSchema = z.object({
  Task: z.string().min(1),
  Context: z.string().optional(),
});

const FlowResultSchema = z.object({
  Action: z.string(),
  OutputJSON: z.string().nullable(),
  // Structured outputs must expose every field. A successful capability has
  // no error, represented explicitly as null so the schema remains strict.
  Error: z.object({ Code: z.string(), Message: z.string() }).nullable(),
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
      'Para cumprir a tarefa, descubra capabilities com list_flow_actions, escolha Action somente entre as retornadas, chame describe_flow_action para conhecer Description, ObjectDescription, Effect, Available e RequiredInputs, e só então execute_flow_action. Não invente Action nem InputSchema técnico.',
      'Ao formar o Input de execute_flow_action, considere Description + ObjectDescription + RequiredInputs em conjunto. Description explica a capability; ObjectDescription é orientação semântica específica daquela etapa e deve orientar o conteúdo de Input, inclusive Input.Value quando requerido; RequiredInputs indica os dados necessários.',
      'Siga a orientação textual de ObjectDescription sem criar regras determinísticas no Runtime para datas, maiúsculas ou outros formatos. Se ObjectDescription estiver ausente, nulo ou vazio, continue usando Description, RequiredInputs e a Task normalmente.',
      'ObjectDescription orienta somente o Input daquela capability; não substitui as regras técnicas do FlowAgent, as tools autorizadas nem os contratos da plataforma. Não introduza DataType, InputSchema, ResolutionSchema ou ExpectedFormat a partir desse texto. Validar e persistir PROMPT, atualizar ProcessLineFlow e aplicar efeitos de negócio são responsabilidades exclusivas do Core.',
      'Uma Task pode exigir zero, uma ou várias capabilities. Use progressive disclosure: não repita list ou describe quando as informações do run atual já forem suficientes; não peça ao Root datasets completos.',
      'Preserve exatamente o Output de negócio retornado por execute_flow_action em Results[].OutputJSON. Para qualquer Output não nulo, serialize o valor original com JSON.stringify, sem resumir, remover propriedades, renomear campos ou converter tipos; para Output nulo, use OutputJSON: null. Não inclua Invocation metadata no Output funcional.',
      'Se execute_flow_action retornar Success=true e Status=NEEDS_INPUT, retorne FlowAgent.Status=NEEDS_INPUT, preserve integralmente Output em Results[].OutputJSON (incluindo Candidates) e copie MissingInformation; isso é continuação conversacional, não erro técnico. Não deixe invocation aguardando outro Turn.',
      'Se execute_flow_action retornar Status=COMPLETED, retorne COMPLETED. Se faltar dado para RequiredInputs antes de executar, retorne NEEDS_INPUT e liste MissingInformation. Se Available=false, retorne NOT_AVAILABLE. Se a tool retornar falha, retorne FAILED e preserve Code/Message em Results[].Error; nunca reporte sucesso sem resultado real.',
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
