import OpenAI from 'openai';
import type { KnowledgeSearchProvider, KnowledgeSearchRequest, KnowledgeSearchResult } from './KnowledgeSearchProvider.js';

type SearchClient = Pick<OpenAI, 'vectorStores'>;

export class OpenAIKnowledgeSearchProvider implements KnowledgeSearchProvider {
  constructor(private readonly createClient: (credential: string, organization?: string, project?: string) => SearchClient =
    (credential, organization, project) => new OpenAI({ apiKey: credential, organization, project })) {}

  async search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult[]> {
    const client = this.createClient(
      request.credential,
      request.connection.ExternalOrganizationId ?? undefined,
      request.connection.ExternalProjectId ?? undefined,
    );
    const page = await client.vectorStores.search(request.reference.ExternalStoreId, {
      query: request.query,
      max_num_results: request.options.MaxResults,
      ...(request.filter ? { filters: request.filter } : {}),
      ...(request.options.ScoreThreshold === undefined ? {} : { ranking_options: { score_threshold: request.options.ScoreThreshold } }),
      ...(request.options.RewriteQuery === undefined ? {} : { rewrite_query: request.options.RewriteQuery }),
    });
    // The provider owns raw OpenAI results. Only safe, functional fields cross this boundary.
    return page.data.flatMap((entry) => {
      const content = entry.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
      return content ? [{ SourceName: entry.filename, Content: content }] : [];
    });
  }
}
