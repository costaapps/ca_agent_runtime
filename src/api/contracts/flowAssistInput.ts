import { z } from 'zod';

const IdSchema = z.number().int().positive();

export const FlowAssistTargetSchema = z.object({
  IdProcessLineFlow: IdSchema,
  Step: z.number().int().nonnegative(),
  ObjectType: z.enum(['PROMPT', 'CFL', 'CFL_SELREQ']),
  Description: z.string(),
  ObjectDescription: z.string().nullable().optional(),
}).strict();

export const FlowAssistInputSchema = z.object({
  Agent: z.string().min(1),
  IdCompany: IdSchema,
  IdChat: IdSchema,
  IdProcessLine: IdSchema,
  IdProcessLineFlow: IdSchema,
  Instructions: z.string(),
  Messages: z.array(z.object({
    IdMessage: IdSchema,
    Role: z.enum(['USER', 'ASSISTANT']),
    Text: z.string(),
  }).strict()),
  Targets: z.array(FlowAssistTargetSchema),
  Known: z.array(z.object({
    IdProcessLineFlow: IdSchema,
    Step: z.number().int().nonnegative(),
    Description: z.string(),
    Value: z.string(),
  }).strict()).optional(),
}).strict().superRefine((input, context) => {
  for (const [key, ids] of [
    ['Targets', input.Targets.map((target) => target.IdProcessLineFlow)],
    ['Messages', input.Messages.map((message) => message.IdMessage)],
    ['Known', (input.Known ?? []).map((known) => known.IdProcessLineFlow)],
  ] as const) {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', path: [key], message: 'IDs duplicados.' });
    }
  }
});

export type FlowAssistInput = z.infer<typeof FlowAssistInputSchema>;
