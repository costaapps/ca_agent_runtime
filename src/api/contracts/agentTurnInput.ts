import { z } from 'zod';

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

export const AgentTurnInputSchema = z.object({
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
}).passthrough().superRefine((value, context) => {
  if (value.TurnSource === 'MESSAGE') {
    if (value.Messages.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['Messages'], message: 'MESSAGE exige ao menos uma mensagem.' });
    }
    if (value.ActivationContext !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['ActivationContext'], message: 'MESSAGE não aceita ActivationContext.' });
    }
  }

  if (value.TurnSource === 'ACTIVATION' && value.ActivationContext === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['ActivationContext'], message: 'ACTIVATION exige ActivationContext.' });
  }

  if (value.TurnSource === 'ACTIVATION' && value.Messages.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['Messages'], message: 'ACTIVATION exige Messages vazio.' });
  }
});

export type AgentTurnMessage = z.infer<typeof AgentTurnMessageSchema>;
export type TurnSource = z.infer<typeof TurnSourceSchema>;
export type ProcessContext = z.infer<typeof ProcessContextSchema>;
export type ActivationContext = z.infer<typeof ActivationContextSchema>;
export interface AgentTurnInput {
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
  [key: string]: unknown;
}
export type ParsedAgentTurnInput = z.output<typeof AgentTurnInputSchema>;
