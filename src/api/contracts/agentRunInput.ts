import { z } from 'zod';

export const ExpectedOutputSchema = z.object({
  Name: z.string().min(1),
  Description: z.string().min(1),
  Type: z.enum(['string', 'number', 'boolean', 'object', 'array']).optional(),
  AllowedValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  Schema: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const AgentRunInputSchema = z.object({
  Agent: z.string().min(1),
  IdCompany: z.coerce.number().int(),
  IdChat: z.coerce.number().int(),
  IdProcessLine: z.coerce.number().int(),
  IdProcessLineFlow: z.coerce.number().int(),
  Message: z.string(),
  ExpectedOutput: ExpectedOutputSchema,
}).passthrough();

export type ExpectedOutput = z.infer<typeof ExpectedOutputSchema>;
export type AgentRunInput = z.infer<typeof AgentRunInputSchema>;
