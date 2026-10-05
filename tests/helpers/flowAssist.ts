import type { FlowAssistInput } from '../../src/api/contracts/flowAssistInput.js';
import type { FlowAssistAgentOutput } from '../../src/api/contracts/flowAssistOutput.js';

// Core -> Runtime semantic manifest. No database/query/resolver configuration.
export const flowAssistInput: FlowAssistInput = {
  Agent: 'flow-assist-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789,
  Instructions: 'Utilize somente informações identificadas com segurança na conversa.',
  Messages: [
    { IdMessage: 1001, Role: 'USER', Text: 'Quero fazer um pedido para o Café do Mercado.' },
    { IdMessage: 1002, Role: 'ASSISTANT', Text: 'Qual transportadora deseja?' },
    { IdMessage: 1003, Role: 'USER', Text: 'Pode mandar pela jadlog e entregar dia 12 de dezembro de 2026.' },
  ],
  Targets: [
    { IdProcessLineFlow: 81231, Step: 11, ObjectType: 'CFL', Description: 'Cliente', ObjectDescription: 'Identifique o cliente mencionado.' },
    { IdProcessLineFlow: 81232, Step: 12, ObjectType: 'CFL_SELREQ', Description: 'Transportadora', ObjectDescription: 'Identifique a transportadora mencionada pelo usuário.' },
    { IdProcessLineFlow: 81233, Step: 13, ObjectType: 'PROMPT', Description: 'Data de entrega', ObjectDescription: 'Retorne a data no formato AAAA-MM-DD.' },
    { IdProcessLineFlow: 81234, Step: 14, ObjectType: 'PROMPT', Description: 'Observação', ObjectDescription: null },
  ],
  Known: [{ IdProcessLineFlow: 81230, Step: 10, Description: 'Canal', Value: 'Chat' }],
};

export const flowAssistOutput: FlowAssistAgentOutput = {
  Proposals: [
    { IdProcessLineFlow: 81231, Status: 'PROPOSED', Value: 'Café do Mercado' },
    { IdProcessLineFlow: 81232, Status: 'PROPOSED', Value: 'Jadlog' },
    { IdProcessLineFlow: 81233, Status: 'PROPOSED', Value: '2026-12-12' },
    { IdProcessLineFlow: 81234, Status: 'UNKNOWN', Value: null },
  ],
};
