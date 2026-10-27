import { z } from 'zod';
import { KnowledgeConfigurationSchema, type KnowledgeConfiguration } from './knowledgeConfiguration.js';

const IdSchema = z.number().int().positive();

export const FlowAssistTargetSchema = z.object({
  IdProcessLineFlow: IdSchema,
  Step: z.number().int().nonnegative(),
  ObjectType: z.enum(['PROMPT', 'CFL', 'CFL_SELREQ']),
  Description: z.string(),
  ObjectDescription: z.string().nullable().optional(),
}).strict();

const FlowAssistBaseSchema = z.object({
  CompanyUUID: z.string().uuid().transform((value) => value.toLowerCase()),
  Agent: z.string().min(1),
  IdCompany: IdSchema,
  IdChat: IdSchema,
  IdProcessLine: IdSchema,
  IdProcessLineFlow: IdSchema,
  Instructions: z.string(),
  KnowledgeConfiguration: KnowledgeConfigurationSchema.optional(),
  Messages: z.array(z.object({
    IdMessage: IdSchema,
    Role: z.enum(['USER', 'ASSISTANT']),
    Text: z.string(),
  }).strict()),
  Known: z.array(z.object({
    IdProcessLineFlow: IdSchema,
    Step: z.number().int().nonnegative(),
    Description: z.string(),
    Value: z.string(),
  }).strict()).optional(),
}).strict();

function validateSharedInput(input: {
  Instructions: string;
  KnowledgeConfiguration?: KnowledgeConfiguration;
  Targets: { IdProcessLineFlow: number }[];
  Messages: { IdMessage: number }[];
  Known?: { IdProcessLineFlow: number }[];
}, context: z.RefinementCtx): void {
  for (const [key, ids] of [
    ['Targets', input.Targets.map((target) => target.IdProcessLineFlow)],
    ['Messages', input.Messages.map((message) => message.IdMessage)],
    ['Known', (input.Known ?? []).map((known) => known.IdProcessLineFlow)],
  ] as const) {
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: [key], message: 'IDs duplicados.' });
  }
  const authorized = new Set(input.KnowledgeConfiguration?.References.map((item) => item.Reference) ?? []);
  const macros = [...input.Instructions.matchAll(/\{\{knowledge:([^{}]+)\}\}/g)];
  if (macros.length !== [...input.Instructions.matchAll(/\{\{knowledge:/g)].length) {
    context.addIssue({ code: 'custom', path: ['Instructions'], message: 'Knowledge Reference malformada.' });
  }
  for (const match of macros) {
    if (!/^(base:[a-z0-9-]+|document:[a-z0-9-]+\/[a-z0-9-]+)$/.test(match[1]!) || !authorized.has(match[1]!)) {
      context.addIssue({ code: 'custom', path: ['KnowledgeConfiguration'], message: 'Knowledge Reference não autorizada.' });
    }
  }
}

export const FlowAssistPrefillInputSchema = FlowAssistBaseSchema.safeExtend({
  Mode: z.literal('PREFILL').optional(),
  Targets: z.array(FlowAssistTargetSchema),
}).superRefine(validateSharedInput);

export const FlowAssistCheckTargetSchema = FlowAssistTargetSchema.safeExtend({
  Resolved: z.boolean(),
  CurrentValue: z.string().nullable(),
});

export const FlowAssistCheckInputSchema = FlowAssistBaseSchema.safeExtend({
  Mode: z.literal('CHECK'),
  Targets: z.array(FlowAssistCheckTargetSchema),
  Check: z.object({
    Repair: z.boolean(),
    RequireAll: z.boolean().optional(),
    OnRuntimeFailure: z.enum(['BLOCK', 'CONTINUE']).optional(),
    BlockMessage: z.string().optional(),
  }).strict(),
}).superRefine(validateSharedInput);

const FlowAssistStepSchema = z.object({
  IdProcessLineFlow: IdSchema,
  IdFlow: IdSchema.nullable(),
  Step: z.number().int().nonnegative().nullable(),
  ObjectType: z.string().min(1).max(40),
  Description: z.string(),
  ObjectDescription: z.string().nullable().optional(),
  Resolved: z.boolean(),
  CurrentValue: z.string().nullable(),
}).strict();

const FlowAssistV2BaseSchema = FlowAssistBaseSchema.safeExtend({
  ProtocolVersion: z.literal(2),
  StepManifest: z.array(FlowAssistStepSchema),
  Continuation: z.object({
    Enabled: z.boolean(),
    MaxNextAgentAssists: z.number().int().min(0).max(3),
    CandidateTargets: z.array(IdSchema).max(500),
  }).strict(),
}).superRefine((input, context) => {
  const stepIds = input.StepManifest.map((step) => step.IdProcessLineFlow);
  const ordered = input.StepManifest.flatMap((step) => step.Step === null ? [] : [step.Step]);
  if (new Set(stepIds).size !== stepIds.length) context.addIssue({ code: 'custom', path: ['StepManifest'], message: 'IDs de etapas duplicados.' });
  if (new Set(ordered).size !== ordered.length) context.addIssue({ code: 'custom', path: ['StepManifest'], message: 'Steps dinâmicos duplicados.' });
  const candidates = input.Continuation.CandidateTargets;
  if (new Set(candidates).size !== candidates.length) context.addIssue({ code: 'custom', path: ['Continuation', 'CandidateTargets'], message: 'Targets candidatos duplicados.' });
  const available = new Set(stepIds);
  if (candidates.some((id) => !available.has(id))) context.addIssue({ code: 'custom', path: ['Continuation', 'CandidateTargets'], message: 'Target candidato ausente do manifesto.' });
  if (!input.Continuation.Enabled && candidates.length) context.addIssue({ code: 'custom', path: ['Continuation'], message: 'Continuação desabilitada deve ter CandidateTargets vazio.' });
});

export const FlowAssistV2PrefillInputSchema = FlowAssistV2BaseSchema.safeExtend({
  Mode: z.literal('PREFILL').optional(),
  Targets: z.array(FlowAssistTargetSchema),
}).superRefine(validateSharedInput);

export const FlowAssistV2CheckInputSchema = FlowAssistV2BaseSchema.safeExtend({
  Mode: z.literal('CHECK'),
  Targets: z.array(FlowAssistCheckTargetSchema),
  Check: z.object({
    Repair: z.boolean(),
    RequireAll: z.boolean().optional(),
    OnRuntimeFailure: z.enum(['BLOCK', 'CONTINUE']).optional(),
    BlockMessage: z.string().optional(),
  }).strict(),
}).superRefine(validateSharedInput);

// Legacy PREFILL payloads have no Mode. CHECK always uses an explicit discriminator.
export const FlowAssistInputSchema = z.union([
  FlowAssistV2CheckInputSchema, FlowAssistV2PrefillInputSchema,
  FlowAssistCheckInputSchema, FlowAssistPrefillInputSchema,
]);
export type ParsedFlowAssistInput = z.infer<typeof FlowAssistInputSchema>;
export type ParsedFlowAssistPrefillInput = z.infer<typeof FlowAssistPrefillInputSchema>;
export type ParsedFlowAssistCheckInput = z.infer<typeof FlowAssistCheckInputSchema>;
export type FlowAssistV2Input = z.infer<typeof FlowAssistV2PrefillInputSchema> | z.infer<typeof FlowAssistV2CheckInputSchema>;
export type FlowAssistPrefillInput = Omit<ParsedFlowAssistPrefillInput, 'CompanyUUID'> & { CompanyUUID?: string };
export type FlowAssistCheckInput = Omit<ParsedFlowAssistCheckInput, 'CompanyUUID'> & { CompanyUUID?: string };
export type FlowAssistInput = FlowAssistPrefillInput | FlowAssistCheckInput | FlowAssistV2Input;
