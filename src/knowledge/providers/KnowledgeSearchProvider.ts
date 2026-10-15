import type { KnowledgeConnection, KnowledgeFilter, KnowledgeReference, KnowledgeSearchOptions } from '../../api/contracts/knowledgeConfiguration.js';

export interface KnowledgeSearchRequest {
  connection: KnowledgeConnection;
  reference: KnowledgeReference;
  query: string;
  credential: string;
  options: KnowledgeSearchOptions;
  filter: KnowledgeFilter | null;
}

export interface KnowledgeSearchResult { SourceName: string; Content: string }

export interface KnowledgeSearchProvider {
  search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult[]>;
}
