import { handoff, type Agent, type RunContext } from '@openai/agents';
import { z } from 'zod';
import type { RuntimeContextData } from '../../runtime/RuntimeContext.js';
import type { ExecutionLogger } from '../../tracing/ExecutionLogger.js';

export const HandoffReasonSchema = z.object({
  Reason: z.string().min(1),
});

export type HandoffReason = z.infer<typeof HandoffReasonSchema>;

export function createHandoffs(
  salesAgent: Agent<RuntimeContextData, any>,
  supportAgent: Agent<RuntimeContextData, any>,
  logger?: ExecutionLogger,
) {
  const handoffToSales = handoff(salesAgent, {
    toolNameOverride: 'transfer_to_sales_agent',
    toolDescriptionOverride: 'Transfere para o SalesAgent quando a solicitação for comercial, de compra ou de produto. Informe uma razão curta em Reason.',
    inputType: HandoffReasonSchema,
    onHandoff: async (context: RunContext<RuntimeContextData>, input?: HandoffReason) => {
      if (!input?.Reason) throw new Error('Handoff Reason é obrigatório.');
      await logger?.handoff('ChatOrchestrator', 'SalesAgent', input.Reason);
      void context;
    },
  });
  const handoffToSupport = handoff(supportAgent, {
    toolNameOverride: 'transfer_to_support_agent',
    toolDescriptionOverride: 'Transfere para o SupportAgent quando a solicitação for suporte, problema ou dúvida operacional. Informe uma razão curta em Reason.',
    inputType: HandoffReasonSchema,
    onHandoff: async (context: RunContext<RuntimeContextData>, input?: HandoffReason) => {
      if (!input?.Reason) throw new Error('Handoff Reason é obrigatório.');
      await logger?.handoff('ChatOrchestrator', 'SupportAgent', input.Reason);
      void context;
    },
  });
  return [handoffToSales, handoffToSupport] as const;
}
