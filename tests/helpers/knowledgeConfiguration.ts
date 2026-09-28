export const configuredKnowledge = {
  Version: 1,
  Connections: [{ Code: 'openai-default', Provider: 'OPENAI', CredentialSource: 'RUNTIME_ENV', CredentialReference: 'OPENAI_API_KEY', ExternalOrganizationId: null, ExternalProjectId: null }],
  References: [
    { Reference: 'base:commercial', Kind: 'BASE', Name: 'Base Comercial', Description: 'Informações comerciais.', ConnectionCode: 'openai-default', ExternalStoreId: 'vs_secret' },
    { Reference: 'document:commercial/refund-policy', Kind: 'DOCUMENT', Name: 'Política de Reembolso', ConnectionCode: 'openai-default', ExternalStoreId: 'vs_secret', ExternalFileId: 'file_secret', Filter: { type: 'eq', key: 'ca_document_code', value: 'refund-policy' }, SearchOptions: { MaxResults: 3, ScoreThreshold: 0.5, RewriteQuery: true } },
  ],
};
