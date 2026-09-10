import { describe, expect, it } from 'vitest';
import { RunContext } from '@openai/agents';
import { createRuntimeContext } from '../../src/runtime/RuntimeContext.js';
import { McpObservabilityRegistry, ToolCallTracker } from '../../src/mcp/observability.js';
import { createToolMetaResolver } from '../../src/mcp/toolMetaResolver.js';
import { createCustomDataExtractor } from '../../src/mcp/customDataExtractor.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { ExecutionLogger } from '../../src/tracing/ExecutionLogger.js';

function makeContext() {
  return createRuntimeContext({
    Agent: 'chat-orchestrator-poc', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789,
    Message: 'Olá', ExpectedOutput: { Name: 'Intent', Description: 'Identifique.' },
  }, 'uuid');
}

describe('MCP context integration', () => {
  it('sends only policy metadata and merges returned Resolved data', async () => {
    const context = makeContext();
    const repository = new MemoryRepository();
    const logger = new ExecutionLogger(repository, 1);
    const registry = new McpObservabilityRegistry();
    registry.register(context, logger);
    const tracker = new ToolCallTracker();
    const resolver = createToolMetaResolver(registry, tracker);
    const extractor = createCustomDataExtractor(registry, tracker);
    const runContext = new RunContext(context);

    const meta = await resolver({ runContext, serverName: 'fake', toolName: 'get_chat_history', arguments: {} });
    expect(meta).toEqual({ ca: { Execution: { IdChat: 123 } } });
    expect(meta).not.toHaveProperty('ca.Execution.IdCompany');
    await extractor({
      runContext,
      serverName: 'fake',
      toolName: 'get_chat_history',
      toolDisplayName: 'get_chat_history',
      arguments: {},
      resultMeta: { ca: { Resolved: { IdDocument: 987 } } },
      structuredContent: { Messages: [] },
      isError: false,
      toolOutput: { Messages: [] },
    });
    expect(context.Resolved).toEqual({ IdDocument: 987 });
    expect(repository.logs.map((entry) => entry.data.EventType)).toEqual(['MCP_TOOL_CALL', 'MCP_TOOL_RESULT']);
  });

  it('fails on conflicting technical identity and records tool errors', async () => {
    const context = makeContext();
    context.Resolved.IdDocument = 987;
    const registry = new McpObservabilityRegistry();
    const tracker = new ToolCallTracker();
    const extractor = createCustomDataExtractor(registry, tracker);
    await expect(extractor({
      runContext: new RunContext(context), serverName: 'fake', toolName: 'get_chat_history', toolDisplayName: 'get_chat_history',
      arguments: {}, resultMeta: { ca: { Resolved: { IdDocument: 999 } } }, structuredContent: {}, isError: false, toolOutput: {},
    })).rejects.toThrow('Resolved context');
  });
});
