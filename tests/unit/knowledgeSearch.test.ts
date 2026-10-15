import { describe, expect, it, vi } from 'vitest';
import { RunContext } from '@openai/agents';
import { KnowledgeConfigurationSchema } from '../../src/api/contracts/knowledgeConfiguration.js';
import { KnowledgeSearchService } from '../../src/knowledge/KnowledgeSearchService.js';
import { EnvironmentProviderCredentialResolver } from '../../src/knowledge/credentials/EnvironmentProviderCredentialResolver.js';
import { OpenAIKnowledgeSearchProvider } from '../../src/knowledge/providers/OpenAIKnowledgeSearchProvider.js';
import { createSearchKnowledgeTool, SearchKnowledgeArgumentsSchema } from '../../src/knowledge/tools/createSearchKnowledgeTool.js';
import { createAIDocumentRuntimeContext } from '../../src/runtime/RuntimeContext.js';
import { ExecutionLogger } from '../../src/tracing/ExecutionLogger.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { configuredKnowledge } from '../helpers/knowledgeConfiguration.js';

const snapshot = KnowledgeConfigurationSchema.parse(configuredKnowledge);
const context = createAIDocumentRuntimeContext({ CompanyUUID: '14ed24ea-0000-4000-8000-000000000001', TurnUUID: '14ed24ea-0000-4000-8000-000000000601', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, Messages: [{ IdMessage: 601, Text: 'Reembolso' }] }, 'execution-uuid', 'session-uuid', { CompanyUUID: '14ed24ea-0000-4000-8000-000000000001', IdDatabase: 8, IdCompany: 1003 });

describe('local Knowledge search boundary', () => {
  it('searches an authorized BASE without a filter and uses the runtime default', async () => {
    const search = vi.fn().mockResolvedValue([{ SourceName: 'catalogo.pdf', Content: 'Produtos disponíveis.', score: 0.98, file_id: 'file_secret' }]);
    const service = new KnowledgeSearchService({ search }, new EnvironmentProviderCredentialResolver({ OPENAI_API_KEY: 'secret-key' }));
    const searched = await service.search(snapshot, 'base:commercial', 'Produtos?');
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: 'Produtos?', credential: 'secret-key', filter: null, options: { MaxResults: 5 } }));
    expect(searched.result).toEqual({ Status: 'FOUND', Reference: 'base:commercial', Knowledge: { Kind: 'BASE', Name: 'Base Comercial' }, Results: [{ SourceName: 'catalogo.pdf', Content: 'Produtos disponíveis.' }] });
    expect(JSON.stringify(searched.result)).not.toMatch(/secret-key|vs_secret|file_secret|score|file_id|store_id/);
  });

  it('searches a DOCUMENT with the snapshot filter and effective options', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const service = new KnowledgeSearchService({ search }, new EnvironmentProviderCredentialResolver({ OPENAI_API_KEY: 'secret-key' }));
    const searched = await service.search(snapshot, 'document:commercial/refund-policy', 'Reembolso?');
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ filter: { type: 'eq', key: 'ca_document_code', value: 'refund-policy' }, options: { MaxResults: 3, ScoreThreshold: 0.5, RewriteQuery: true } }));
    expect(searched.result).toEqual({ Status: 'NO_RESULTS', Reference: 'document:commercial/refund-policy', Knowledge: { Kind: 'DOCUMENT', Name: 'Política de Reembolso' }, Results: [] });
  });

  it('rejects unauthorized references, unsupported providers, absent keys and provider errors', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const service = new KnowledgeSearchService({ search }, new EnvironmentProviderCredentialResolver({ OPENAI_API_KEY: 'secret-key' }));
    await expect(service.search(snapshot, 'base:finance', 'query')).rejects.toThrow('KNOWLEDGE_REFERENCE_NOT_AUTHORIZED');
    expect(search).not.toHaveBeenCalled();
    const unsupported = KnowledgeConfigurationSchema.parse({ ...configuredKnowledge, Connections: [{ ...configuredKnowledge.Connections[0], Provider: 'OTHER' }] });
    await expect(service.search(unsupported, 'base:commercial', 'query')).rejects.toThrow('KNOWLEDGE_PROVIDER_NOT_SUPPORTED');
    const missingKey = new KnowledgeSearchService({ search }, new EnvironmentProviderCredentialResolver({}));
    await expect(missingKey.search(snapshot, 'base:commercial', 'query')).rejects.toThrow('KNOWLEDGE_CREDENTIAL_NOT_CONFIGURED');
    search.mockRejectedValueOnce(new Error('provider payload with secret-key'));
    await expect(service.search(snapshot, 'base:commercial', 'query')).rejects.toThrow('KNOWLEDGE_PROVIDER_ERROR');
  });

  it('offers exactly Reference and Query to the model and logs metadata without content or credentials', async () => {
    const search = vi.fn().mockResolvedValue([{ SourceName: 'politica.pdf', Content: 'Texto de política confidencial.' }]);
    const service = new KnowledgeSearchService({ search }, new EnvironmentProviderCredentialResolver({ OPENAI_API_KEY: 'secret-key' }));
    const repository = new MemoryRepository();
    const localTool = createSearchKnowledgeTool(snapshot, service, context, new ExecutionLogger(repository, 1), 'SalesAgent');
    expect(SearchKnowledgeArgumentsSchema.safeParse({ Reference: 'base:commercial', Query: 'x', IdCompany: 1003 }).success).toBe(false);
    for (const extra of ['VectorStoreId', 'FileId', 'IdCompany', 'Filter', 'Provider', 'APIKey', 'MaxResults', 'ScoreThreshold', 'RewriteQuery', 'ConnectionCode']) {
      expect(SearchKnowledgeArgumentsSchema.safeParse({ Reference: 'base:commercial', Query: 'x', [extra]: 'bad' }).success).toBe(false);
    }
    expect(localTool.parameters).toMatchObject({ additionalProperties: false });
    const result = await localTool.invoke(new RunContext(context), JSON.stringify({ Reference: 'base:commercial', Query: 'Produtos?' }));
    expect(JSON.parse(result as string).Status).toBe('FOUND');
    expect(repository.logs).toHaveLength(1);
    expect(repository.logs[0]!.data.EventType).toBe('KNOWLEDGE_SEARCH');
    expect(repository.logs[0]!.data).toMatchObject({ AgentName: 'SalesAgent', ToolName: 'search_knowledge', Status: 'FOUND' });
    expect(repository.logs[0]!.data.InputJSON).toContain('session-uuid');
    expect(JSON.stringify(repository.logs)).not.toMatch(/secret-key|Texto de política confidencial|vs_secret|file_secret/);
  });

  it('passes only configured OpenAI search parameters and normalizes away raw provider fields', async () => {
    const search = vi.fn().mockResolvedValue({ data: [{ filename: 'politica.pdf', file_id: 'file_secret', score: 0.95, content: [{ type: 'text', text: 'Prazo de 14 dias.' }] }] });
    const provider = new OpenAIKnowledgeSearchProvider(() => ({ vectorStores: { search } } as any));
    const service = new KnowledgeSearchService(provider, new EnvironmentProviderCredentialResolver({ OPENAI_API_KEY: 'secret-key' }));
    const searched = await service.search(snapshot, 'document:commercial/refund-policy', 'prazo');
    expect(search).toHaveBeenCalledWith('vs_secret', { query: 'prazo', max_num_results: 3, filters: { type: 'eq', key: 'ca_document_code', value: 'refund-policy' }, ranking_options: { score_threshold: 0.5 }, rewrite_query: true });
    expect(searched.result.Results).toEqual([{ SourceName: 'politica.pdf', Content: 'Prazo de 14 dias.' }]);
    expect(JSON.stringify(searched.result)).not.toMatch(/file_secret|vs_secret|score/);
  });
});
