import { z } from 'zod';

export const AgentSessionCloseInputSchema = z.object({
  CompanyUUID: z.string().uuid().transform((value) => value.toLowerCase()),
  IdCompany: z.coerce.number().int().positive(),
  IdProcessLine: z.coerce.number().int().positive(),
  Reason: z.string().min(1).optional(),
}).passthrough();

export type ParsedAgentSessionCloseInput = z.infer<typeof AgentSessionCloseInputSchema>;
export interface AgentSessionCloseInput {
  CompanyUUID?: string;
  IdCompany: number;
  IdProcessLine: number;
  Reason?: string;
  [key: string]: unknown;
}

export interface AgentSessionCloseOutput {
  Success: true;
  SessionUUID: string;
  Status: 'CLOSED';
}
