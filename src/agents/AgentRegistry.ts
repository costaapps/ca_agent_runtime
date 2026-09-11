import type { MCPServer } from '@openai/agents';
import type { JsonSchemaDefinition } from '@openai/agents';
import { AgentNotFoundError } from '../errors/RuntimeError.js';
import type { RuntimeContextData } from '../runtime/RuntimeContext.js';
import type { CompiledExpectedOutput } from '../runtime/ExpectedOutputCompiler.js';
import type { ExecutionLogger } from '../tracing/ExecutionLogger.js';
import { createChatOrchestrator, type AgentGraph } from './orchestrator.js';
import { createAIDocumentRootAgent, type AIDocumentAgentGraph } from './aidocument/rootAgents.js';

export type { AgentGraph } from './orchestrator.js';

export interface AgentBuildContext {
  outputType: JsonSchemaDefinition;
  expectedOutput: CompiledExpectedOutput;
  mcpServer: MCPServer;
  model: string;
  runtimeContext: RuntimeContextData;
  logger: ExecutionLogger;
}

export interface AIDocumentAgentBuildContext {
  mcpServer: MCPServer;
  model: string;
  runtimeContext: RuntimeContextData;
  logger: ExecutionLogger;
}

export type AgentFactory = (context: AgentBuildContext) => AgentGraph;

export class AgentRegistry {
  private readonly factories = new Map<string, AgentFactory>();
  private readonly aidocumentFactories = new Map<string, (context: AIDocumentAgentBuildContext) => AIDocumentAgentGraph>();

  constructor(
    factories?: Record<string, AgentFactory>,
    aidocumentFactories?: Record<string, (context: AIDocumentAgentBuildContext) => AIDocumentAgentGraph>,
  ) {
    this.factories.set('chat-orchestrator-poc', (context) => createChatOrchestrator(context.outputType, context.mcpServer, context.model, context.logger));
    for (const [key, factory] of Object.entries(factories ?? {})) this.factories.set(key, factory);
    this.aidocumentFactories.set('sales-agent', (context) => createAIDocumentRootAgent('SalesAgent', context.mcpServer, context.model));
    this.aidocumentFactories.set('support-agent', (context) => createAIDocumentRootAgent('SupportAgent', context.mcpServer, context.model));
    for (const [key, factory] of Object.entries(aidocumentFactories ?? {})) this.aidocumentFactories.set(key, factory);
  }

  has(agentKey: string): boolean {
    return this.factories.has(agentKey);
  }

  build(agentKey: string, context: AgentBuildContext): AgentGraph {
    const factory = this.factories.get(agentKey);
    if (!factory) throw new AgentNotFoundError(agentKey);
    return factory(context);
  }

  hasAIDocument(agentKey: string): boolean {
    return this.aidocumentFactories.has(agentKey);
  }

  buildAIDocument(agentKey: string, context: AIDocumentAgentBuildContext): AIDocumentAgentGraph {
    const factory = this.aidocumentFactories.get(agentKey);
    if (!factory) throw new AgentNotFoundError(agentKey);
    return factory(context);
  }
}
