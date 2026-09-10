import { describe, expect, it } from 'vitest';
import { Agent } from '@openai/agents';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { McpObservabilityRegistry } from '../../src/mcp/observability.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import type { RuntimeContextData } from '../../src/runtime/RuntimeContext.js';

const request = {
  Agent: 'chat-orchestrator-poc', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789,
  Message: 'Quero comprar um carro.', ExpectedOutput: { Name: 'Intent', Description: 'Classifique.' },
};

describe('AgentRuntime lifecycle', () => {
  it('creates, runs, logs, and finalizes an execution without OpenAI', async () => {
    const repository = new MemoryRepository();
    const registry = new AgentRegistry({
      'chat-orchestrator-poc': (build) => {
        const agent = new Agent<RuntimeContextData, any>({ name: 'ChatOrchestrator', instructions: 'test', outputType: build.outputType as any });
        return { root: agent, agents: [agent] };
      },
    });
    const runtime = new AgentRuntime({
      repository,
      registry,
      runner: {
        async run(_agent, _message, context) {
          context.Resolved.LastLookup = 'fake';
          return { finalOutput: { Intent: 'SALES' }, lastAgent: { name: 'SalesAgent' } };
        },
      },
      mcpServer: createFakeMcpServer(),
      observability: new McpObservabilityRegistry(),
      model: 'test-model',
      tracingEnabled: true,
      traceIncludeSensitiveData: false,
    });

    const result = await runtime.run(request);
    expect(result.statusCode).toBe(200);
    expect(result.response).toMatchObject({ Success: true, Output: { Intent: 'SALES' } });
    expect(repository.executions[0]?.data.ExecutionUUID).toMatch(/^[0-9a-f-]{36}$/);
    expect(repository.executions[0]?.data.OpenAITraceId).toMatch(/^trace_[0-9a-f]{32}$/);
    expect(repository.executions[0]?.final).toMatchObject({ Success: 'Y', FinalAgent: 'SalesAgent' });
    expect(repository.logs.map((entry) => entry.data.EventType)).toContain('AGENT_OUTPUT');
    expect(repository.logs.map((entry) => entry.data.EventType)).toContain('RUNTIME_END');
  });

  it('returns a traceable failure for invalid model output', async () => {
    const repository = new MemoryRepository();
    const registry = new AgentRegistry({
      'chat-orchestrator-poc': (build) => {
        const agent = new Agent<RuntimeContextData, any>({ name: 'ChatOrchestrator', instructions: 'test', outputType: build.outputType as any });
        return { root: agent, agents: [agent] };
      },
    });
    const runtime = new AgentRuntime({
      repository, registry,
      runner: { async run() { return { finalOutput: { Wrong: true } }; } },
      mcpServer: createFakeMcpServer(), observability: new McpObservabilityRegistry(), model: 'test-model', tracingEnabled: false, traceIncludeSensitiveData: false,
    });
    const result = await runtime.run(request);
    expect(result.statusCode).toBe(500);
    expect(result.response).toMatchObject({ Success: false, Output: null, Error: { Code: 'INVALID_AGENT_OUTPUT' } });
    expect(repository.executions[0]?.final).toMatchObject({ Success: 'N', ErrorCode: 'INVALID_AGENT_OUTPUT' });
  });
});
