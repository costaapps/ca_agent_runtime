import { z } from 'zod';

const KnowledgeCodeSchema = z.string().regex(/^[a-z0-9-]+$/);
export const EmptyKnowledgeConfiguration = { Version: 1 as const, Connections: [], References: [] };

const FilterValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export const KnowledgeFilterSchema: z.ZodType<KnowledgeFilter> = z.lazy(() => z.union([
  z.strictObject({
    type: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']),
    key: z.string().min(1),
    value: FilterValueSchema,
  }),
  z.strictObject({
    type: z.enum(['in', 'nin']),
    key: z.string().min(1),
    value: z.array(z.union([z.string(), z.number()])).min(1),
  }),
  z.strictObject({ type: z.enum(['and', 'or']), filters: z.array(KnowledgeFilterSchema).min(1) }),
]));

export type KnowledgeFilter =
  | { type: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'; key: string; value: string | number | boolean }
  | { type: 'in' | 'nin'; key: string; value: (string | number)[] }
  | { type: 'and' | 'or'; filters: KnowledgeFilter[] };

export const KnowledgeSearchOptionsSchema = z.strictObject({
  MaxResults: z.number().int().min(1).max(50).optional(),
  ScoreThreshold: z.number().min(0).max(1).optional(),
  RewriteQuery: z.boolean().optional(),
});

export const KnowledgeConnectionSchema = z.strictObject({
  Code: KnowledgeCodeSchema,
  Provider: z.string().min(1),
  CredentialSource: z.string().min(1),
  CredentialReference: z.string().min(1),
  ExternalOrganizationId: z.string().nullable().optional(),
  ExternalProjectId: z.string().nullable().optional(),
});

export const KnowledgeReferenceSchema = z.strictObject({
  Reference: z.string().regex(/^(base:[a-z0-9-]+|document:[a-z0-9-]+\/[a-z0-9-]+)$/),
  Kind: z.enum(['BASE', 'DOCUMENT']),
  Name: z.string().min(1),
  Description: z.string().nullable().optional(),
  ConnectionCode: KnowledgeCodeSchema,
  ExternalStoreId: z.string().min(1),
  ExternalFileId: z.string().nullable().optional(),
  Filter: KnowledgeFilterSchema.nullable().optional(),
  SearchOptions: KnowledgeSearchOptionsSchema.optional(),
}).superRefine((reference, context) => {
  if (reference.Reference.startsWith('base:') !== (reference.Kind === 'BASE')) {
    context.addIssue({ code: 'custom', path: ['Kind'], message: 'Kind não corresponde à Reference.' });
  }
  if (reference.Kind === 'BASE' && reference.Filter != null) {
    context.addIssue({ code: 'custom', path: ['Filter'], message: 'BASE deve pesquisar toda a base.' });
  }
  if (reference.Kind === 'DOCUMENT' && reference.Filter == null) {
    context.addIssue({ code: 'custom', path: ['Filter'], message: 'DOCUMENT exige Filter.' });
  }
});

export const KnowledgeConfigurationSchema = z.strictObject({
  Version: z.literal(1),
  Connections: z.array(KnowledgeConnectionSchema),
  References: z.array(KnowledgeReferenceSchema),
}).superRefine((configuration, context) => {
  const connections = new Set<string>();
  for (const [index, connection] of configuration.Connections.entries()) {
    if (connections.has(connection.Code)) context.addIssue({ code: 'custom', path: ['Connections', index, 'Code'], message: 'ConnectionCode duplicado.' });
    connections.add(connection.Code);
  }
  const references = new Set<string>();
  for (const [index, reference] of configuration.References.entries()) {
    if (references.has(reference.Reference)) context.addIssue({ code: 'custom', path: ['References', index, 'Reference'], message: 'Reference duplicada.' });
    references.add(reference.Reference);
    if (!connections.has(reference.ConnectionCode)) context.addIssue({ code: 'custom', path: ['References', index, 'ConnectionCode'], message: 'ConnectionCode não encontrado.' });
  }
});

export type KnowledgeConfiguration = z.output<typeof KnowledgeConfigurationSchema>;
export type KnowledgeConnection = z.output<typeof KnowledgeConnectionSchema>;
export type KnowledgeReference = z.output<typeof KnowledgeReferenceSchema>;
export type KnowledgeSearchOptions = z.output<typeof KnowledgeSearchOptionsSchema>;

export function effectiveKnowledgeConfiguration(value: KnowledgeConfiguration | undefined): KnowledgeConfiguration {
  return value ?? { Version: 1, Connections: [], References: [] };
}
