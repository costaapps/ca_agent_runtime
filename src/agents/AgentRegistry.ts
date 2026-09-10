import type { MCPServer } from '@openai/agents';
import type { JsonSchemaDefinition } from '@openai/agents';
import { AgentNotFoundError } from '../errors/RuntimeError.js';
import type { RuntimeContextData } from '../runtime/RuntimeContext.js';
import type { CompiledExpectedOutput } from '../runtime/ExpectedOutputCompiler.js';
import type { ExecutionLogger } from '../tracing/ExecutionLogger.js';
import { createChatOrchestrator, type AgentGraph } from './orchestrator.js';

export type { AgentGraph } from './orchestrator.js';

export interface AgentBuildContext {
  outputType: JsonSchemaDefinition;
  expectedOutput: CompiledExpectedOutput;
  mcpServer: MCPServer;
  model: string;
  runtimeContext: RuntimeContextData;
  logger: ExecutionLogger;
}

export type AgentFactory = (context: AgentBuildContext) => AgentGraph;

export class AgentRegistry {
  private readonly factories = new Map<string, AgentFactory>();

  constructor(factories?: Record<string, AgentFactory>) {
    this.factories.set('chat-orchestrator-poc', (context) => createChatOrchestrator(context.outputType, context.mcpServer, context.model, context.logger));
    for (const [key, factory] of Object.entries(factories ?? {})) this.factories.set(key, factory);
  }

  has(agentKey: string): boolean {
    return this.factories.has(agentKey);
  }

  build(agentKey: string, context: AgentBuildContext): AgentGraph {
    const factory = this.factories.get(agentKey);
    if (!factory) throw new AgentNotFoundError(agentKey);
    return factory(context);
  }
}
