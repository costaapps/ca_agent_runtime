import { z } from 'zod';

// Fixed transport schema, never a business schema generated for each target.
export const FlowAssistAgentOutputSchema = z.object({
  Proposals: z.array(z.object({
    IdProcessLineFlow: z.number().int().positive(),
    Status: z.enum(['PROPOSED', 'UNKNOWN']),
    Value: z.string().nullable(),
  }).strict()),
}).strict().superRefine(({ Proposals }, context) => {
  Proposals.forEach((proposal, index) => {
    if (proposal.Status === 'PROPOSED' && (proposal.Value === null || !proposal.Value.trim())) {
      context.addIssue({ code: 'custom', path: ['Proposals', index, 'Value'], message: 'PROPOSED exige string não vazia.' });
    }
    if (proposal.Status === 'UNKNOWN' && proposal.Value !== null) {
      context.addIssue({ code: 'custom', path: ['Proposals', index, 'Value'], message: 'UNKNOWN exige null.' });
    }
  });
});

export const FlowAssistSuccessSchema = FlowAssistAgentOutputSchema.safeExtend({
  Success: z.literal(true),
  ExecutionUUID: z.uuid(),
});

export const FlowAssistFailureSchema = z.object({
  Success: z.literal(false),
  ExecutionUUID: z.uuid().optional(),
  Proposals: z.array(z.never()).length(0),
  Error: z.object({ Code: z.string(), Message: z.string() }).strict(),
}).strict();

export const FlowAssistOutputSchema = z.union([FlowAssistSuccessSchema, FlowAssistFailureSchema]);
export type FlowAssistAgentOutput = z.infer<typeof FlowAssistAgentOutputSchema>;
export type FlowAssistOutput = z.infer<typeof FlowAssistOutputSchema>;
