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

export const FlowAssistPrefillOutputSchema = z.union([FlowAssistSuccessSchema, FlowAssistFailureSchema]);

export const FlowAssistCheckAgentOutputSchema = z.object({
  Mode: z.literal('CHECK'),
  Results: z.array(z.object({
    IdProcessLineFlow: z.number().int().positive(),
    Action: z.enum(['KEEP', 'SET', 'REPLACE', 'MISSING', 'INVALID']),
    Value: z.string().nullable(),
    Reason: z.string().nullable(),
  }).strict()),
}).strict().superRefine(({ Results }, context) => {
  Results.forEach((result, index) => {
    if ((result.Action === 'SET' || result.Action === 'REPLACE') && (result.Value === null || !result.Value.trim())) {
      context.addIssue({ code: 'custom', path: ['Results', index, 'Value'], message: 'SET/REPLACE exige string não vazia.' });
    }
    if (result.Action !== 'SET' && result.Action !== 'REPLACE' && result.Value !== null) {
      context.addIssue({ code: 'custom', path: ['Results', index, 'Value'], message: 'Esta ação exige Value=null.' });
    }
    if (result.Action !== 'MISSING' && result.Action !== 'INVALID' && result.Reason !== null) {
      context.addIssue({ code: 'custom', path: ['Results', index, 'Reason'], message: 'Reason é reservado para MISSING/INVALID.' });
    }
    if (result.Reason && result.Reason.length > 300) {
      context.addIssue({ code: 'custom', path: ['Results', index, 'Reason'], message: 'Reason deve ser curto.' });
    }
    if (result.Reason && /\b(?:IdCompany|IdChat|IdProcessLine|IdProcessLineFlow|ExecutionUUID|CFL\.Key|KnowledgeReference|VectorStore|FileId|Provider)\b|\b(?:base|document):[a-z0-9/-]+|sk-[a-z0-9_-]+/i.test(result.Reason)) {
      context.addIssue({ code: 'custom', path: ['Results', index, 'Reason'], message: 'Reason não deve conter identificadores internos.' });
    }
  });
});

const NextAgentAssistSchema = z.object({
  Agent: z.string().min(1).max(100),
  Mode: z.enum(['PREFILL', 'CHECK']),
  Instructions: z.string().max(5000),
  AfterIdProcessLineFlow: z.number().int().positive(),
  TargetIdProcessLineFlows: z.array(z.number().int().positive()).min(1).max(50),
}).strict().superRefine((assist, context) => {
  if (new Set(assist.TargetIdProcessLineFlows).size !== assist.TargetIdProcessLineFlows.length) {
    context.addIssue({ code: 'custom', path: ['TargetIdProcessLineFlows'], message: 'Targets duplicados.' });
  }
});

export const FlowAssistCheckSuccessSchema = FlowAssistCheckAgentOutputSchema.safeExtend({
  Success: z.literal(true),
  ExecutionUUID: z.uuid(),
});

export const FlowAssistCheckFailureSchema = z.object({
  Success: z.literal(false),
  ExecutionUUID: z.uuid().optional(),
  Mode: z.literal('CHECK'),
  Results: z.array(z.never()).length(0),
  Error: z.object({ Code: z.string(), Message: z.string() }).strict(),
}).strict();

const FlowAssistV2OutputFields = {
  NextAgentAssists: z.array(NextAgentAssistSchema).max(3),
};

export const FlowAssistV2PrefillAgentOutputSchema = FlowAssistAgentOutputSchema.safeExtend(FlowAssistV2OutputFields);
export const FlowAssistV2CheckAgentOutputSchema = FlowAssistCheckAgentOutputSchema.safeExtend(FlowAssistV2OutputFields);
export const FlowAssistV2AgentOutputSchema = z.union([FlowAssistV2PrefillAgentOutputSchema, FlowAssistV2CheckAgentOutputSchema]);

export const FlowAssistV2SuccessSchema = z.union([
  FlowAssistSuccessSchema.safeExtend({ ProtocolVersion: z.literal(2), ...FlowAssistV2OutputFields }),
  FlowAssistCheckSuccessSchema.safeExtend({ ProtocolVersion: z.literal(2), ...FlowAssistV2OutputFields }),
]);

export const FlowAssistV2FailureSchema = z.union([
  FlowAssistFailureSchema.safeExtend({ ProtocolVersion: z.literal(2) }),
  FlowAssistCheckFailureSchema.safeExtend({ ProtocolVersion: z.literal(2) }),
]);

export const FlowAssistOutputSchema = z.union([FlowAssistV2SuccessSchema, FlowAssistV2FailureSchema, FlowAssistSuccessSchema, FlowAssistFailureSchema, FlowAssistCheckSuccessSchema, FlowAssistCheckFailureSchema]);
export type FlowAssistAgentOutput = z.infer<typeof FlowAssistAgentOutputSchema>;
export type FlowAssistCheckAgentOutput = z.infer<typeof FlowAssistCheckAgentOutputSchema>;
export type FlowAssistOutput = z.infer<typeof FlowAssistOutputSchema>;
