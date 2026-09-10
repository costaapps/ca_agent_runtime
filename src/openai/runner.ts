import { Runner, type Agent } from '@openai/agents';
import type { RuntimeContextData } from '../runtime/RuntimeContext.js';
import type { TraceSettings } from './tracing.js';

export interface AgentRunResultLike {
  finalOutput?: unknown;
  lastAgent?: { name: string };
}

export interface OpenAIRunner {
  run(agent: Agent<RuntimeContextData, any>, message: string, context: RuntimeContextData, tracing: TraceSettings): Promise<AgentRunResultLike>;
}

export function createOpenAIRunner(): OpenAIRunner {
  return {
    async run(agent, message, context, tracing) {
      const runner = new Runner({
        model: tracing.model,
        workflowName: 'Msg4 AI Flow',
        traceId: tracing.traceId,
        groupId: String(tracing.idChat),
        traceMetadata: {
          ExecutionUUID: tracing.executionUUID,
          IdProcessLineFlow: String(tracing.idProcessLineFlow),
        },
        tracingDisabled: !tracing.enabled,
        traceIncludeSensitiveData: tracing.includeSensitiveData,
      });
      const result = await runner.run(agent, message, { context, stream: false });
      const output: AgentRunResultLike = { finalOutput: result.finalOutput };
      if (result.lastAgent) output.lastAgent = { name: result.lastAgent.name };
      return output;
    },
  };
}
