import type { KnowledgeConnection } from '../../api/contracts/knowledgeConfiguration.js';
import type { ProviderCredentialResolver } from './ProviderCredentialResolver.js';

/** Maps the existing RUNTIME_ENV/OPENAI_API_KEY descriptor to the tenant-scoped key. */
export class TenantOpenAICredentialResolver implements ProviderCredentialResolver {
  constructor(private readonly resolveOpenAIKey: () => Promise<string>) {}

  async resolve(connection: KnowledgeConnection): Promise<string> {
    if (connection.Provider !== 'OPENAI' || connection.CredentialSource !== 'RUNTIME_ENV' || connection.CredentialReference !== 'OPENAI_API_KEY') {
      throw new Error('KNOWLEDGE_PROVIDER_NOT_SUPPORTED');
    }
    return this.resolveOpenAIKey();
  }
}
