import { Agent, type MCPServer, type JsonSchemaDefinition } from '@openai/agents';
import type { RuntimeContextData } from '../../runtime/RuntimeContext.js';

export function createSupportAgent(outputType: JsonSchemaDefinition, mcpServer: MCPServer, model: string): Agent<RuntimeContextData, any> {
  return new Agent<RuntimeContextData, any>({
    name: 'SupportAgent',
    handoffDescription: 'Especialista em suporte, problemas e dúvidas operacionais.',
    model,
    outputType: outputType as any,
    instructions: ({ context }) => [
      'Você é o SupportAgent da Costa Apps.',
      'Trate solicitações de suporte, problemas e dúvidas operacionais.',
      `A saída final deve respeitar ExpectedOutput.Description: ${context.Execution.ExpectedOutput.Description}`,
      'Use as tools MCP somente quando precisar de histórico ou estado da Flow. Não peça ao usuário IDs técnicos.',
      'Não exponha raciocínio interno; produza somente a saída estruturada solicitada.',
    ].join('\n'),
    mcpServers: [mcpServer],
    mcpConfig: { convertSchemasToStrict: true },
  });
}
