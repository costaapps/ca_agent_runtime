import { describe, expect, it } from 'vitest';
import { AgentRunInputSchema } from '../../src/api/contracts/agentRunInput.js';

describe('AgentRunInputSchema', () => {
  it('accepts the frozen contract and additional fields', () => {
    const result = AgentRunInputSchema.safeParse({
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
});
