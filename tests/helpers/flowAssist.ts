import type { FlowAssistCheckInput, FlowAssistPrefillInput, FlowAssistV2Input } from '../../src/api/contracts/flowAssistInput.js';
import type { FlowAssistCheckAgentOutput } from '../../src/api/contracts/flowAssistOutput.js';
import type { FlowAssistAgentOutput } from '../../src/api/contracts/flowAssistOutput.js';

// Core -> Runtime semantic manifest. No database/query/resolver configuration.
export const flowAssistInput: FlowAssistPrefillInput = {
  CompanyUUID: 'd2719f62-8a67-4fd5-a6ae-411a6a3ef177',
  Agent: 'flow-assist-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789,
  Instructions: 'Utilize somente informações identificadas com segurança na conversa.',
  Messages: [
    { IdMessage: 1001, Role: 'USER', Text: 'Quero fazer um pedido para o Café do Mercado.' },
    { IdMessage: 1002, Role: 'ASSISTANT', Text: 'Qual transportadora deseja?' },
    { IdMessage: 1003, Role: 'USER', Text: 'Pode mandar pela jadlog e entregar dia 12 de dezembro de 2026.' },
  ],
  Targets: [
    { IdProcessLineFlow: 81231, Step: 11, ObjectType: 'CFL', Description: 'Cliente', ObjectDescription: 'Identifique o cliente mencionado.',
      Choices: [{ SelectionValue: 'Café do Mercado', Display: 'Café do Mercado' }, { SelectionValue: 'Mercado Central', Display: 'Mercado Central' }] },
    { IdProcessLineFlow: 81232, Step: 12, ObjectType: 'CFL_SELREQ', Description: 'Transportadora', ObjectDescription: 'Identifique a transportadora mencionada pelo usuário.',
      Choices: [{ SelectionValue: 'Jadlog', Display: 'Jadlog' }, { SelectionValue: 'Sedex', Display: 'Sedex' }] },
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

export const flowAssistCheckInput: FlowAssistCheckInput = {
  ...flowAssistInput,
  Mode: 'CHECK',
  Instructions: 'Confira os valores; para transportadora consulte {{knowledge:base:commercial}}.',
  Check: { Repair: true, RequireAll: true, OnRuntimeFailure: 'BLOCK', BlockMessage: 'Preciso revisar os dados.' },
  Targets: [
    { IdProcessLineFlow: 81231, Step: 11, ObjectType: 'PROMPT', Description: 'Cliente', ObjectDescription: 'Confirme o cliente.', Resolved: true, CurrentValue: 'Café do Mercado' },
    { IdProcessLineFlow: 81232, Step: 12, ObjectType: 'CFL', Description: 'Transportadora', ObjectDescription: 'Conforme política comercial.',
      Choices: [{ SelectionValue: 'Jadlog', Display: 'Jadlog' }, { SelectionValue: 'Sedex', Display: 'Sedex' }], Resolved: true, CurrentValue: 'Transportadora incorreta' },
    { IdProcessLineFlow: 81233, Step: 13, ObjectType: 'CFL_SELREQ', Description: 'Nova transportadora', ObjectDescription: 'Identifique a opção mencionada.',
      Choices: [{ SelectionValue: 'Jadlog', Display: 'Jadlog' }, { SelectionValue: 'Sedex', Display: 'Sedex' }], Resolved: false, CurrentValue: null },
  ],
};

export const flowAssistCheckOutput: FlowAssistCheckAgentOutput = {
  Mode: 'CHECK',
  Results: [
    { IdProcessLineFlow: 81231, Action: 'KEEP', Value: null, Reason: null },
    { IdProcessLineFlow: 81232, Action: 'REPLACE', Value: 'Jadlog', Reason: null },
    { IdProcessLineFlow: 81233, Action: 'SET', Value: 'Jadlog', Reason: null },
  ],
};

export const flowAssistV2Input: FlowAssistV2Input = {
  ...flowAssistInput,
  CompanyUUID: 'd2719f62-8a67-4fd5-a6ae-411a6a3ef177',
  ProtocolVersion: 2,
  StepManifest: [
    { IdProcessLineFlow: 789, IdFlow: 100, Step: 10, ObjectType: 'AGENTASSIST', Description: 'Assistente', ObjectDescription: null, Resolved: false, CurrentValue: null },
    { IdProcessLineFlow: 81231, IdFlow: 101, Step: 11, ObjectType: 'CFL', Description: 'Cliente', ObjectDescription: 'Identifique o cliente mencionado.', Resolved: false, CurrentValue: null,
      Choices: [{ SelectionValue: 'Café do Mercado', Display: 'Café do Mercado' }, { SelectionValue: 'Mercado Central', Display: 'Mercado Central' }] },
    { IdProcessLineFlow: 81232, IdFlow: 102, Step: 12, ObjectType: 'CFL_SELREQ', Description: 'Transportadora', ObjectDescription: 'Identifique a transportadora mencionada.', Resolved: false, CurrentValue: null,
      Choices: [{ SelectionValue: 'Jadlog', Display: 'Jadlog' }, { SelectionValue: 'Sedex', Display: 'Sedex' }] },
    { IdProcessLineFlow: 81233, IdFlow: 103, Step: 13, ObjectType: 'PROMPT', Description: 'Data de entrega', ObjectDescription: 'Formato AAAA-MM-DD.', Resolved: false, CurrentValue: null },
    { IdProcessLineFlow: 81234, IdFlow: 104, Step: 14, ObjectType: 'PROMPT', Description: 'Observação', ObjectDescription: null, Resolved: false, CurrentValue: null },
  ],
  Continuation: { Enabled: true, MaxNextAgentAssists: 2, CandidateTargets: [81231, 81232, 81233, 81234] },
};
