import { z } from 'zod';

export const AgentTurnMessageSchema = z.object({
  IdMessage: z.coerce.number().int().positive(),
  Text: z.string().min(1),
}).passthrough();

export const AgentTurnInputSchema = z.object({
  TurnUUID: z.string().uuid(),
  Agent: z.string().min(1),
  IdCompany: z.coerce.number().int().positive(),
  IdChat: z.coerce.number().int().positive(),
  IdProcessLine: z.coerce.number().int().positive(),
  Messages: z.array(AgentTurnMessageSchema).min(1),
}).passthrough();

export type AgentTurnMessage = z.infer<typeof AgentTurnMessageSchema>;
export type AgentTurnInput = z.infer<typeof AgentTurnInputSchema>;
