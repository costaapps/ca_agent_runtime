import { describe, expect, it } from 'vitest';
import { Agent } from '@openai/agents';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { McpObservabilityRegistry } from '../../src/mcp/observability.js';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import type { RuntimeContextData } from '../../src/runtime/RuntimeContext.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';

const input = {
  Agent: 'chat-orchestrator-poc', IdCompany: 501, IdChat: 10, IdProcessLine: 20, IdProcessLineFlow: 30,
  Message: 'Olá', ExpectedOutput: { Name: 'Intent', Description: 'Classifique.' },
};

function runtimeFor(companyKey: string, seenKeys: string[]) {
  const registry = new AgentRegistry({
    'chat-orchestrator-poc': (build) => {
      const agent = new Agent<RuntimeContextData, any>({ name: 'TestAgent', instructions: 'test', outputType: build.outputType as any });
      return { root: agent, agents: [agent] };
    },
  });
  return new AgentRuntime({
    repository: new MemoryRepository(),
    registry,
    runner: {
      async run(_agent, _input, _context, _tracing, _session, resolveKey) {
        seenKeys.push(await resolveKey!());
        return { finalOutput: { Intent: 'SALES' } };
      },
    },
    resolveOpenAIKey: async () => companyKey,
    mcpServer: createFakeMcpServer(),
    observability: new McpObservabilityRegistry(),
    model: 'gpt-6-luna',
    tracingEnabled: false,
    traceIncludeSensitiveData: false,
  });
}

describe('per-company OpenAI credential isolation', () => {
  it('keeps credentials separate for concurrent executions with the same local IdCompany', async () => {
    const observed: string[] = [];
    const first = runtimeFor('tenant-one-secret', observed);
    const second = runtimeFor('tenant-two-secret', observed);

    const results = await Promise.all([first.run(input), second.run(input)]);

    expect(results.map((result) => result.statusCode)).toEqual([200, 200]);
    expect(observed.sort()).toEqual(['tenant-one-secret', 'tenant-two-secret']);
  });
});
