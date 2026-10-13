import { Runner, type Agent, type AgentInputItem, type Session } from '@openai/agents';
import type { RuntimeContextData } from '../runtime/RuntimeContext.js';
import type { TraceSettings } from './tracing.js';

export interface AgentRunResultLike {
  finalOutput?: unknown;
  lastAgent?: { name: string };
}

export interface OpenAIRunner {
  run(agent: Agent<RuntimeContextData, any>, input: string | AgentInputItem[], context: RuntimeContextData, tracing: TraceSettings, session?: Session): Promise<AgentRunResultLike>;
}

export function createOpenAIRunner(): OpenAIRunner {
  return {
    async run(agent, input, context, tracing, session) {
      const runner = new Runner({
        model: tracing.model,
        workflowName: 'Msg4 AI Flow',
        traceId: tracing.traceId,
        groupId: tracing.companyUUID && tracing.idDatabase !== undefined
          ? `${tracing.companyUUID}:${tracing.idDatabase}:${tracing.idChat}`
          : String(tracing.idChat),
        traceMetadata: {
          ExecutionUUID: tracing.executionUUID,
          CompanyUUID: tracing.companyUUID ?? '',
          IdDatabase: tracing.idDatabase === undefined ? '' : String(tracing.idDatabase),
          IdProcessLine: String(tracing.idProcessLine),
          IdProcessLineFlow: tracing.idProcessLineFlow === null ? '' : String(tracing.idProcessLineFlow),
          SessionUUID: tracing.sessionUUID ?? '',
          TurnUUID: tracing.turnUUID ?? '',
          TurnSource: tracing.turnSource ?? '',
          ProcessContextRevision: tracing.processContextRevision === undefined ? '' : String(tracing.processContextRevision),
          ActivationUUID: tracing.activationUUID ?? '',
          RootAgent: tracing.rootAgent ?? agent.name,
        },
        tracingDisabled: !tracing.enabled,
        traceIncludeSensitiveData: tracing.includeSensitiveData,
      });
      const result = await runner.run(agent, input, { context, stream: false, session });
      const output: AgentRunResultLike = { finalOutput: result.finalOutput };
      if (result.lastAgent) output.lastAgent = { name: result.lastAgent.name };
      return output;
    },
  };
}
