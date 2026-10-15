import { describe, expect, it } from 'vitest';
import { AgentRunInputSchema } from '../../src/api/contracts/agentRunInput.js';
import { AgentSessionCloseInputSchema } from '../../src/api/contracts/agentSessionClose.js';
import { AgentTurnInputSchema } from '../../src/api/contracts/agentTurnInput.js';
import { FlowAssistInputSchema } from '../../src/api/contracts/flowAssistInput.js';
import { flowAssistInput } from '../helpers/flowAssist.js';

describe('AgentRunInputSchema', () => {
  it('accepts the frozen contract and additional fields', () => {
    const result = AgentRunInputSchema.safeParse({
      CompanyUUID: '14ed24ea-0000-4000-8000-000000000001',
      Agent: 'chat-orchestrator-poc',
      IdCompany: '1003',
      IdChat: 123,
      IdProcessLine: 456,
      IdProcessLineFlow: 789,
      Message: 'Quero comprar um carro.',
      ExpectedOutput: { Name: 'Intent', Description: 'Identifique a intenção.' },
      FutureField: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.IdCompany).toBe(1003);
  });

  it('rejects missing required properties', () => {
    const result = AgentRunInputSchema.safeParse({ Agent: 'chat-orchestrator-poc' });
    expect(result.success).toBe(false);
  });

  it('requires CompanyUUID at every HTTP boundary', () => {
    expect(AgentRunInputSchema.safeParse({ CompanyUUID: undefined, Agent: 'chat-orchestrator-poc' }).success).toBe(false);
    expect(AgentTurnInputSchema.safeParse({ TurnUUID: '14ed24ea-0000-4000-8000-000000000001', Agent: 'sales-agent', IdCompany: 10, IdChat: 1, IdProcessLine: 1, Messages: [{ IdMessage: 1, Text: 'Hi' }] }).success).toBe(false);
    expect(AgentSessionCloseInputSchema.safeParse({ IdCompany: 10, IdProcessLine: 1 }).success).toBe(false);
    expect(FlowAssistInputSchema.safeParse({ ...flowAssistInput, CompanyUUID: undefined }).success).toBe(false);
  });
});
