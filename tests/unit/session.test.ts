import { describe, expect, it } from 'vitest';
import { RunContext } from '@openai/agents';
import { DatabaseAgentSession } from '../../src/session/DatabaseAgentSession.js';
import { createAIDocumentRuntimeContext } from '../../src/runtime/RuntimeContext.js';
import { MemorySessionRepository } from '../helpers/memorySessionRepository.js';

const context = createAIDocumentRuntimeContext({
  TurnUUID: '14ed24ea-0000-4000-8000-000000000001', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456,
  Messages: [{ IdMessage: 1001, Text: 'Olá' }],
}, 'execution-uuid', 'session-uuid');

describe('DatabaseAgentSession', () => {
  it('reads and appends native AgentInputItems in sequence with the execution context', async () => {
    const repository = new MemorySessionRepository();
    await repository.createSession({ SessionUUID: 'session-uuid', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, RootAgent: 'sales-agent', Status: 'OPEN', StartedAt: new Date(), LastActivityAt: new Date(), ClosedAt: null });
    const session = new DatabaseAgentSession('session-uuid', repository);
    const runContext = new RunContext(context);
    await session.addItems([{ role: 'user', content: 'Olá' }], runContext);
    await session.addItems([{ role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Oi' }] }], runContext);

    expect(await session.getSessionId()).toBe('session-uuid');
    expect(await session.getItems()).toEqual([
      { role: 'user', content: 'Olá' },
      { role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Oi' }] },
    ]);
    expect(repository.executionUUIDs.get('session-uuid')).toEqual(['execution-uuid', 'execution-uuid']);
    expect(await session.popItem()).toMatchObject({ role: 'assistant' });
    expect(await session.getItems()).toHaveLength(1);
  });
});
