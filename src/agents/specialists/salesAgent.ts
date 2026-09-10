import { Agent, type MCPServer, type JsonSchemaDefinition } from '@openai/agents';
import type { RuntimeContextData } from '../../runtime/RuntimeContext.js';

export function createSalesAgent(outputType: JsonSchemaDefinition, mcpServer: MCPServer, model: string): Agent<RuntimeContextData, any> {
  return new Agent<RuntimeContextData, any>({
    name: 'SalesAgent',
    handoffDescription: 'Especialista em demandas comerciais, compras e produtos.',
    model,
    outputType: outputType as any,
    instructions: ({ context }) => [
      'Você é o SalesAgent da Costa Apps.',
      'Trate intenções comerciais, compras e perguntas sobre produtos.',
      `A saída final deve respeitar ExpectedOutput.Description: ${context.Execution.ExpectedOutput.Description}`,
      'Use as tools MCP somente quando precisar de histórico ou estado da Flow. Não peça ao usuário IDs técnicos.',
      'Não exponha raciocínio interno; produza somente a saída estruturada solicitada.',
    ].join('\n'),
    mcpServers: [mcpServer],
    mcpConfig: { convertSchemasToStrict: true },
  });
}
