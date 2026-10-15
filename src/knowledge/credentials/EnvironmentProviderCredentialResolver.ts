import type { KnowledgeConnection } from '../../api/contracts/knowledgeConfiguration.js';
import type { ProviderCredentialResolver } from './ProviderCredentialResolver.js';

export class EnvironmentProviderCredentialResolver implements ProviderCredentialResolver {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  resolve(connection: KnowledgeConnection): string {
    if (connection.Provider !== 'OPENAI' || connection.CredentialSource !== 'RUNTIME_ENV' || connection.CredentialReference !== 'OPENAI_API_KEY') {
      throw new Error('KNOWLEDGE_PROVIDER_NOT_SUPPORTED');
    }
    const key = this.environment.OPENAI_API_KEY;
    if (!key) throw new Error('KNOWLEDGE_CREDENTIAL_NOT_CONFIGURED');
    return key;
  }
}
