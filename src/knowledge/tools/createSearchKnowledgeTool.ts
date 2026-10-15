import { tool } from '@openai/agents';
import { z } from 'zod';
import type { KnowledgeConfiguration } from '../../api/contracts/knowledgeConfiguration.js';
import type { RuntimeContextData } from '../../runtime/RuntimeContext.js';
import type { ExecutionLogger } from '../../tracing/ExecutionLogger.js';
import { ExecutionEventTypes } from '../../tracing/eventTypes.js';
import type { KnowledgeSearchService } from '../KnowledgeSearchService.js';

export const SearchKnowledgeArgumentsSchema = z.strictObject({
  Reference: z.string().min(1),
  Query: z.string().min(1),
});

export function createSearchKnowledgeTool(
  snapshot: KnowledgeConfiguration,
  service: KnowledgeSearchService,
  runtimeContext: RuntimeContextData,
  logger?: ExecutionLogger,
  agentName?: string,
  onError?: () => void,
) {
  return tool<typeof SearchKnowledgeArgumentsSchema, RuntimeContextData>({
    name: 'search_knowledge',
    description: 'Pesquisa uma Knowledge Reference autorizada nesta execução. Forneça somente Reference e Query; IDs técnicos e opções são resolvidos pelo Runtime.',
    parameters: SearchKnowledgeArgumentsSchema,
    execute: async ({ Reference, Query }) => {
      const startedAt = Date.now();
      const knowledge = snapshot.References.find((item) => item.Reference === Reference);
      const configuredConnection = snapshot.Connections.find((item) => item.Code === knowledge?.ConnectionCode);
      let status = 'ERROR';
      let resultCount = 0;
      let provider = configuredConnection?.Provider;
      let connectionCode = configuredConnection?.Code;
      try {
        const searched = await service.search(snapshot, Reference, Query);
        status = searched.result.Status;
        resultCount = searched.result.Results.length;
        provider = searched.provider;
        connectionCode = searched.connectionCode;
        return JSON.stringify(searched.result);
      } catch (error) {
        onError?.();
        throw error;
      } finally {
        await logger?.append(ExecutionEventTypes.KnowledgeSearch, {
          AgentName: agentName,
          ToolName: 'search_knowledge',
          InputJSON: JSON.stringify({
            ExecutionUUID: runtimeContext.Execution.ExecutionUUID,
            TurnUUID: runtimeContext.Execution.TurnUUID,
            SessionUUID: runtimeContext.Execution.SessionUUID,
            IdCompany: runtimeContext.Execution.IdCompany,
            KnowledgeReference: Reference,
            KnowledgeKind: knowledge?.Kind,
            Provider: provider,
            ConnectionCode: connectionCode,
            ResultCount: resultCount,
          }),
          Status: status,
          DurationMs: Date.now() - startedAt,
        });
      }
    },
  });
}
