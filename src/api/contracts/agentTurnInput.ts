import { z } from 'zod';
import { KnowledgeConfigurationSchema, type KnowledgeConfiguration } from './knowledgeConfiguration.js';

export const TurnSourceSchema = z.enum(['MESSAGE', 'ACTIVATION']);

export const AgentTurnMessageSchema = z.object({
  IdMessage: z.coerce.number().int().positive(),
  Text: z.string().min(1),
}).passthrough();

const ProcessContextNamespaceSchema = z.record(z.string(), z.unknown());

export const ProcessContextSchema = z.object({
  System: ProcessContextNamespaceSchema.default({}),
  Facts: ProcessContextNamespaceSchema.default({}),
  BusinessReferences: ProcessContextNamespaceSchema.default({}),
  CurrentIntent: ProcessContextNamespaceSchema.default({}),
}).passthrough();

const emptyProcessContext = { System: {}, Facts: {}, BusinessReferences: {}, CurrentIntent: {} };

export const ActivationContextSchema = z.object({
  ActivationUUID: z.string().min(1),
  Source: z.enum(['HANDOFF', 'MODULE_COMPLETED', 'OUTBOUND', 'QUEUED', 'SEQUENTIAL']),
  Context: z.record(z.string(), z.unknown()).default({}),
}).passthrough();

export const AgentConfigurationSchema = z.object({
  Code: z.string().min(1),
  Revision: z.coerce.number().int().nonnegative(),
  Instructions: z.string(),
  Name: z.string().nullable().optional(),
});

export const AgentContextSchema = z.object({
  Name: z.string().min(1),
  Objective: z.string().min(1),
  Instructions: z.string(),
  CompletionCriteria: z.array(z.string().min(1)),
}).strict();

const AgentTurnInputObjectSchema = z.object({
  CompanyUUID: z.string().uuid().transform((value) => value.toLowerCase()),
  TurnUUID: z.string().uuid(),
  Agent: z.string().min(1),
  IdCompany: z.coerce.number().int().positive(),
  IdChat: z.coerce.number().int().positive(),
  IdProcessLine: z.coerce.number().int().positive(),
  TurnSource: TurnSourceSchema.default('MESSAGE'),
  Messages: z.array(AgentTurnMessageSchema),
  ProcessContextRevision: z.coerce.number().int().nonnegative().default(0),
  ProcessContext: ProcessContextSchema.default(emptyProcessContext),
  ActivationContext: ActivationContextSchema.nullable().default(null),
  AgentConfiguration: AgentConfigurationSchema.nullable().default(null),
  KnowledgeConfiguration: KnowledgeConfigurationSchema.optional(),
  AgentContext: AgentContextSchema.nullable().default(null),
}).passthrough();

function refineTurnInput<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.superRefine((value, context) => {
    const turn = value as {
      AgentConfiguration: { Code: string } | null;
      Agent: string;
      TurnSource: 'MESSAGE' | 'ACTIVATION';
      Messages: unknown[];
      ActivationContext: unknown;
    };
    if (turn.AgentConfiguration && turn.AgentConfiguration.Code !== turn.Agent) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['AgentConfiguration', 'Code'], message: 'AgentConfiguration.Code deve corresponder ao Agent solicitado.' });
    }
    if (turn.TurnSource === 'MESSAGE') {
      if (turn.Messages.length === 0) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['Messages'], message: 'MESSAGE exige ao menos uma mensagem.' });
      }
      if (turn.ActivationContext !== null) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['ActivationContext'], message: 'MESSAGE não aceita ActivationContext.' });
      }
    }

    if (turn.TurnSource === 'ACTIVATION' && turn.ActivationContext === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['ActivationContext'], message: 'ACTIVATION exige ActivationContext.' });
    }

    if (turn.TurnSource === 'ACTIVATION' && turn.Messages.length > 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['Messages'], message: 'ACTIVATION exige Messages vazio.' });
    }
  });
}

export const AgentTurnInputSchema = refineTurnInput(AgentTurnInputObjectSchema);

/** Internal runtime parsing remains usable by unit-level callers; HTTP controllers use the required CompanyUUID schema above. */
export const AgentTurnRuntimeInputSchema = refineTurnInput(AgentTurnInputObjectSchema.extend({
  CompanyUUID: z.string().uuid().transform((value) => value.toLowerCase()).optional(),
}));

export type AgentTurnMessage = z.infer<typeof AgentTurnMessageSchema>;
export type TurnSource = z.infer<typeof TurnSourceSchema>;
export type ProcessContext = z.infer<typeof ProcessContextSchema>;
export type ActivationContext = z.infer<typeof ActivationContextSchema>;
export type AgentConfiguration = z.output<typeof AgentConfigurationSchema>;
export type AgentContext = z.output<typeof AgentContextSchema>;
export interface AgentTurnInput {
  CompanyUUID?: string;
  TurnUUID: string;
  Agent: string;
  IdCompany: number;
  IdChat: number;
  IdProcessLine: number;
  TurnSource?: TurnSource;
  Messages: AgentTurnMessage[];
  ProcessContextRevision?: number;
  ProcessContext?: ProcessContext;
  ActivationContext?: ActivationContext | null;
  AgentConfiguration?: AgentConfiguration | null;
  KnowledgeConfiguration?: KnowledgeConfiguration;
  AgentContext?: AgentContext | null;
  [key: string]: unknown;
}
export type ParsedAgentTurnInput = z.output<typeof AgentTurnInputSchema>;
