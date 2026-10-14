import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import { createOpenAIRunner } from '../../src/openai/runner.js';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { McpObservabilityRegistry } from '../../src/mcp/observability.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';

const enabled = process.env.RUN_OPENAI_INTEGRATION_TESTS === '1';

describe.skipIf(!enabled)('OpenAI smoke test', () => {
  it('runs the orchestrator and produces ExpectedOutput with a clear sales request', async () => {
    const model = process.env.OPENAI_MODEL;
    if (!model) throw new Error('OPENAI_MODEL é obrigatório para o smoke test.');
    const repository = new MemoryRepository();
    const runtime = new AgentRuntime({
      repository,
      registry: new AgentRegistry(),
      runner: createOpenAIRunner(),
      resolveOpenAIKey: async () => {
        const key = process.env.OPENAI_API_KEY;
        if (!key) throw new Error('OPENAI_API_KEY é obrigatório para o smoke test live.');
        return key;
      },
      mcpServer: createFakeMcpServer(),
      observability: new McpObservabilityRegistry(),
      model,
      tracingEnabled: true,
      traceIncludeSensitiveData: false,
    });

    const result = await runtime.run({
      Agent: 'chat-orchestrator-poc',
      IdCompany: 1003,
      IdChat: 123,
      IdProcessLine: 456,
      IdProcessLineFlow: 789,
      Message: 'Quero comprar um carro novo e saber quais opções comerciais existem.',
      ExpectedOutput: {
        Name: 'Intent',
        Description: 'Classifique a intenção principal.',
        AllowedValues: ['SALES', 'SUPPORT', 'OTHER'],
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.response.Success).toBe(true);
    expect(repository.logs.some((entry) => entry.data.EventType === 'HANDOFF')).toBe(true);
    expect(repository.executions[0]?.final?.FinalAgent).toBe('SalesAgent');
  }, 120_000);
});
