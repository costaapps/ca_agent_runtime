import { z } from 'zod';

export const AIDocumentControlSchema = z.object({
  CompletionRequested: z.boolean(),
  Reason: z.string().nullable(),
});

export const AIDocumentRootOutputSchema = z.object({
  Response: z.string(),
  Control: AIDocumentControlSchema,
});

export type AIDocumentControl = z.infer<typeof AIDocumentControlSchema>;
export type AIDocumentRootOutput = z.infer<typeof AIDocumentRootOutputSchema>;

export interface AgentTurnSuccess {
  Success: true;
  TurnUUID: string;
  SessionUUID: string;
  ExecutionUUID: string;
  Agent: string;
  Response: string;
  Control: AIDocumentControl;
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
