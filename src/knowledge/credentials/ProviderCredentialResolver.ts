import type { KnowledgeConnection } from '../../api/contracts/knowledgeConfiguration.js';

export interface ProviderCredentialResolver {
  resolve(connection: KnowledgeConnection): string;
}
