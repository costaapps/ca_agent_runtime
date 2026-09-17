import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { AgentNotFoundError } from '../../src/errors/RuntimeError.js';

describe('HTTP API', () => {
  it('validates requests and exposes the health endpoint', async () => {
    const app = createApp({
      async run(input: any) {
        return { statusCode: 200 as const, response: { Success: true as const, ExecutionUUID: 'uuid', Output: { Intent: input.ExpectedOutput.Name } } };
      },
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: 'ok' });

      const invalid = await fetch(`http://127.0.0.1:${port}/v1/agent-runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
      expect(invalid.status).toBe(400);
      expect((await invalid.json()).Error.Code).toBe('INVALID_REQUEST');

      const valid = await fetch(`http://127.0.0.1:${port}/v1/agent-runs`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ Agent: 'chat-orchestrator-poc', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789, Message: 'Olá', ExpectedOutput: { Name: 'Intent', Description: 'Classifique.' }, Extra: 'accepted' }),
      });
      expect(valid.status).toBe(200);
      expect((await valid.json()).Output).toEqual({ Intent: 'Intent' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('maps an unknown Agent to HTTP 422 without an execution id', async () => {
    const app = createApp({
      async run() { throw new AgentNotFoundError('missing-agent'); },
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/agent-runs`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Agent: 'missing-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789, Message: 'Olá', ExpectedOutput: { Name: 'Intent', Description: 'Classifique.' } }),
      });
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body).toMatchObject({ Success: false, Output: null, Error: { Code: 'AGENT_NOT_FOUND' } });
      expect(body.ExecutionUUID).toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('exposes AIDocument turn and session close routes without changing the legacy route', async () => {
    const app = createApp({
      async run(input: any) {
        return { statusCode: 200 as const, response: { Success: true as const, ExecutionUUID: 'legacy-uuid', Output: { Intent: input.ExpectedOutput.Name } } };
      },
      async runTurn(input: any) {
        return { statusCode: 200 as const, response: { Success: true as const, TurnUUID: input.TurnUUID, SessionUUID: 'session-uuid', ExecutionUUID: 'execution-uuid', Agent: input.Agent, Response: 'Ok', Control: { CompletionRequested: false, Reason: null } } };
      },
      async closeSession() {
        return { statusCode: 200 as const, response: { Success: true as const, SessionUUID: 'session-uuid', Status: 'CLOSED' as const } };
      },
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
      const invalidTurn = await fetch(`http://127.0.0.1:${port}/v1/agent-turns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Agent: 'sales-agent' }) });
      expect(invalidTurn.status).toBe(400);

      const turn = await fetch(`http://127.0.0.1:${port}/v1/agent-turns`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ TurnUUID: '14ed24ea-0000-4000-8000-000000000001', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, Messages: [{ IdMessage: 1, Text: 'Oi' }] }),
      });
      expect(turn.status).toBe(200);
      expect(await turn.json()).toMatchObject({ Success: true, SessionUUID: 'session-uuid' });

      const close = await fetch(`http://127.0.0.1:${port}/v1/agent-sessions/close`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ IdCompany: 1003, IdProcessLine: 456, Reason: 'PROCESS_LINE_CLOSED' }),
      });
      expect(close.status).toBe(200);
      expect(await close.json()).toMatchObject({ Success: true, Status: 'CLOSED' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
