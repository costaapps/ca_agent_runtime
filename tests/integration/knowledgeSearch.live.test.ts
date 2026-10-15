import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { KnowledgeSearchService } from '../../src/knowledge/KnowledgeSearchService.js';
import { EnvironmentProviderCredentialResolver } from '../../src/knowledge/credentials/EnvironmentProviderCredentialResolver.js';
import { OpenAIKnowledgeSearchProvider } from '../../src/knowledge/providers/OpenAIKnowledgeSearchProvider.js';
import type { KnowledgeConfiguration } from '../../src/api/contracts/knowledgeConfiguration.js';

const enabled = process.env.RUN_OPENAI_INTEGRATION_TESTS === '1'
  && Boolean(process.env.OPENAI_API_KEY)
  && Boolean(process.env.OPENAI_TEST_VECTOR_STORE_ID);

describe.skipIf(!enabled)('OpenAI Knowledge V1 live', () => {
  const base: KnowledgeConfiguration = {
    Version: 1,
    Connections: [{ Code: 'openai-default', Provider: 'OPENAI', CredentialSource: 'RUNTIME_ENV', CredentialReference: 'OPENAI_API_KEY' }],
    References: [{ Reference: 'base:live', Kind: 'BASE', Name: 'Base live', ConnectionCode: 'openai-default', ExternalStoreId: process.env.OPENAI_TEST_VECTOR_STORE_ID! }],
  };
  const service = new KnowledgeSearchService(new OpenAIKnowledgeSearchProvider(), new EnvironmentProviderCredentialResolver());

  it('searches an authorized base without exposing provider identifiers', async () => {
    const searched = await service.search(base, 'base:live', process.env.OPENAI_TEST_QUERY ?? 'informações gerais');
    expect(['FOUND', 'NO_RESULTS']).toContain(searched.result.Status);
    expect(JSON.stringify(searched.result)).not.toContain(process.env.OPENAI_TEST_VECTOR_STORE_ID!);
  }, 120_000);

  it.skipIf(!process.env.OPENAI_TEST_DOCUMENT_FILTER_KEY || !process.env.OPENAI_TEST_DOCUMENT_FILTER_VALUE)('applies a document attribute filter', async () => {
    const configuration: KnowledgeConfiguration = {
      ...base,
      References: [{ ...base.References[0]!, Reference: 'document:live/test', Kind: 'DOCUMENT', Filter: { type: 'eq', key: process.env.OPENAI_TEST_DOCUMENT_FILTER_KEY!, value: process.env.OPENAI_TEST_DOCUMENT_FILTER_VALUE! } }],
    };
    const searched = await service.search(configuration, 'document:live/test', process.env.OPENAI_TEST_QUERY ?? 'informações gerais');
    expect(['FOUND', 'NO_RESULTS']).toContain(searched.result.Status);
  }, 120_000);
});
