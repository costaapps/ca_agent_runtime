import { z } from 'zod';

const ContextValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
  z.record(z.string(), z.string()),
]);

const ContextUpdateBaseSchema = {
  Key: z.string().min(1),
};

const FactsContextUpdateSchema = z.union([
  z.object({ ...ContextUpdateBaseSchema, Namespace: z.literal('Facts'), Operation: z.literal('SET'), Value: ContextValueSchema, Source: z.literal('USER') }),
  z.object({ ...ContextUpdateBaseSchema, Namespace: z.literal('Facts'), Operation: z.literal('REMOVE'), Value: z.null(), Source: z.literal('USER') }),
]);

const CurrentIntentContextUpdateSchema = z.union([
  z.object({ ...ContextUpdateBaseSchema, Namespace: z.literal('CurrentIntent'), Operation: z.literal('SET'), Value: ContextValueSchema, Source: z.literal('AGENT') }),
  z.object({ ...ContextUpdateBaseSchema, Namespace: z.literal('CurrentIntent'), Operation: z.literal('REMOVE'), Value: z.null(), Source: z.literal('AGENT') }),
]);

export const ContextUpdateSchema = z.union([FactsContextUpdateSchema, CurrentIntentContextUpdateSchema]);

export const AgentControlSchema = z.object({
  CompletionRequested: z.boolean(),
  Reason: z.string().nullable(),
  ContextUpdates: z.array(ContextUpdateSchema).default([]),
});

export const AgentRootOutputSchema = z.object({
  Response: z.string(),
  Control: AgentControlSchema,
});

export type AgentControl = z.infer<typeof AgentControlSchema>;
export type AgentRootOutput = z.infer<typeof AgentRootOutputSchema>;
export type AgentTurnControlResponse = Omit<AgentControl, 'ContextUpdates'> & { ContextUpdates?: AgentControl['ContextUpdates'] };

// Temporary compatibility aliases while the runtime is generalized from AIDocument to Agent Host.
export const AIDocumentControlSchema = AgentControlSchema;
export const AIDocumentRootOutputSchema = AgentRootOutputSchema;
export type AIDocumentControl = AgentControl;
export type AIDocumentRootOutput = AgentRootOutput;

export interface AgentTurnSuccess {
  Success: true;
  TurnUUID: string;
  SessionUUID: string;
  ExecutionUUID: string;
  Agent: string;
  Response: string;
  Control: AgentTurnControlResponse;
}

export interface AgentTurnFailure {
  Success: false;
  TurnUUID: string;
  SessionUUID?: string;
  ExecutionUUID?: string;
  Error: {
    Code: string;
    Message: string;
  };
}

export type AgentTurnOutput = AgentTurnSuccess | AgentTurnFailure;
