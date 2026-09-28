import type { KnowledgeConfiguration } from '../api/contracts/knowledgeConfiguration.js';
import type { ProviderCredentialResolver } from './credentials/ProviderCredentialResolver.js';
import type { KnowledgeSearchProvider, KnowledgeSearchResult } from './providers/KnowledgeSearchProvider.js';

export interface KnowledgeToolResult {
  Status: 'FOUND' | 'NO_RESULTS';
  Reference: string;
  Knowledge: { Kind: 'BASE' | 'DOCUMENT'; Name: string };
  Results: KnowledgeSearchResult[];
}

export class KnowledgeSearchService {
  constructor(
    private readonly provider: KnowledgeSearchProvider,
    private readonly credentials: ProviderCredentialResolver,
  ) {}

  async search(snapshot: KnowledgeConfiguration, referenceCode: string, query: string): Promise<{ result: KnowledgeToolResult; provider: string; connectionCode: string }> {
    const reference = snapshot.References.find((item) => item.Reference === referenceCode);
    if (!reference) throw new Error('KNOWLEDGE_REFERENCE_NOT_AUTHORIZED');
    const connection = snapshot.Connections.find((item) => item.Code === reference.ConnectionCode);
    if (!connection) throw new Error('KNOWLEDGE_CONNECTION_NOT_FOUND');
    const credential = this.credentials.resolve(connection);
    const options = { MaxResults: 5, ...reference.SearchOptions };
    let results: KnowledgeSearchResult[];
    try {
      const rawResults = await this.provider.search({
        connection,
        reference,
        query,
        credential,
        options,
        filter: reference.Kind === 'DOCUMENT' ? reference.Filter ?? null : null,
      });
      results = rawResults.map((item) => ({ SourceName: item.SourceName, Content: item.Content }));
    } catch {
      throw new Error('KNOWLEDGE_PROVIDER_ERROR');
    }
    return {
      provider: connection.Provider,
      connectionCode: connection.Code,
      result: {
        Status: results.length ? 'FOUND' : 'NO_RESULTS',
        Reference: reference.Reference,
        Knowledge: { Kind: reference.Kind, Name: reference.Name },
        Results: results,
      },
    };
  }
}
