import { describe, expect, it } from 'vitest';
import { Agent, RunContext } from '@openai/agents';
import { createHandoffs, HandoffReasonSchema } from '../../src/agents/legacy/handoffs.js';
import { ExecutionLogger } from '../../src/tracing/ExecutionLogger.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { createRuntimeContext } from '../../src/runtime/RuntimeContext.js';

describe('native handoffs', () => {
  it('validates Reason and logs the operational handoff payload', async () => {
    const repo = new MemoryRepository();
    const logger = new ExecutionLogger(repo, 1);
    const target = new Agent({ name: 'SalesAgent', instructions: 'test' });
    const support = new Agent({ name: 'SupportAgent', instructions: 'test' });
    const [toSales] = createHandoffs(target as any, support as any, logger);
    expect(HandoffReasonSchema.parse({ Reason: 'Solicitação comercial' })).toEqual({ Reason: 'Solicitação comercial' });
    const context = createRuntimeContext({
      Agent: 'chat-orchestrator-poc', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789,
      Message: 'Comprar', ExpectedOutput: { Name: 'Intent', Description: 'Classifique.' },
    }, 'uuid');
    await toSales.onInvokeHandoff(new RunContext(context), JSON.stringify({ Reason: 'Solicitação comercial' }));
    expect(repo.logs[0]?.data).toMatchObject({ EventType: 'HANDOFF', TargetAgentName: 'SalesAgent' });
    expect(JSON.parse(repo.logs[0]!.data.InputJSON!)).toEqual({ Reason: 'Solicitação comercial' });
  });
});
