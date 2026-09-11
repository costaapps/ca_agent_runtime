import { z } from 'zod';

export const AgentSessionCloseInputSchema = z.object({
  IdCompany: z.coerce.number().int().positive(),
  IdProcessLine: z.coerce.number().int().positive(),
  Reason: z.string().min(1).optional(),
}).passthrough();

export type AgentSessionCloseInput = z.infer<typeof AgentSessionCloseInputSchema>;

export interface AgentSessionCloseOutput {
  Success: true;
  SessionUUID: string;
  Status: 'CLOSED';
}
