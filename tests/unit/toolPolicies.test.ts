import { describe, expect, it } from 'vitest';
import { RunContext } from '@openai/agents';
import { createRuntimeContext } from '../../src/runtime/RuntimeContext.js';
import { createToolFilter, isToolAvailable } from '../../src/runtime/ToolPolicies.js';

const context = createRuntimeContext({
  Agent: 'chat-orchestrator-poc', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789,
  Message: 'Olá', ExpectedOutput: { Name: 'Intent', Description: 'Identifique.' },
}, 'uuid');

describe('ToolPolicies', () => {
  it('allows specialist tools and hides them from orchestrator', () => {
    expect(isToolAvailable('get_chat_history', 'SalesAgent', context)).toBe(true);
    expect(isToolAvailable('get_chat_history', 'ChatOrchestrator', context)).toBe(false);
    expect(isToolAvailable('unknown_tool', 'SalesAgent', context)).toBe(false);
  });

  it('uses state requirements rather than tool ordering', () => {
    context.Resolved = {};
    expect(isToolAvailable('get_chat_history', 'SupportAgent', context)).toBe(true);
    expect(isToolAvailable('get_document_lines', 'SupportAgent', context)).toBe(false);
  });

  it('implements the SDK callable filter', async () => {
    const filter = createToolFilter();
    const allowed = await filter({ runContext: new RunContext(context), agent: { name: 'SalesAgent' } as any, serverName: 'fake' }, { name: 'get_chat_history' } as any);
    const denied = await filter({ runContext: new RunContext(context), agent: { name: 'ChatOrchestrator' } as any, serverName: 'fake' }, { name: 'get_chat_history' } as any);
    expect(allowed).toBe(true);
    expect(denied).toBe(false);
  });
});
