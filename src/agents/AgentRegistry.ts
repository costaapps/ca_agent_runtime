import type { MCPServer } from '@openai/agents';
import type { JsonSchemaDefinition } from '@openai/agents';
import { AgentNotFoundError } from '../errors/RuntimeError.js';
import type { RuntimeContextData } from '../runtime/RuntimeContext.js';
import type { CompiledExpectedOutput } from '../runtime/ExpectedOutputCompiler.js';
import type { ExecutionLogger } from '../tracing/ExecutionLogger.js';
import { createChatOrchestrator, type AgentGraph } from './legacy/orchestrator.js';
import type { AIDocumentAgentBuildContext, AIDocumentAgentGraph } from './aidocument/contracts.js';
import { createSalesAgent } from './aidocument/roots/salesAgent.js';
import { createSupportAgent } from './aidocument/roots/supportAgent.js';
import { createReceptionAgent } from './aidocument/roots/receptionAgent.js';

export type { AgentGraph } from './legacy/orchestrator.js';

export interface AgentBuildContext {
  outputType: JsonSchemaDefinition;
  expectedOutput: CompiledExpectedOutput;
  mcpServer: MCPServer;
  model: string;
  runtimeContext: RuntimeContextData;
  logger: ExecutionLogger;
}

export type { AIDocumentAgentBuildContext, AIDocumentAgentGraph, HostedAgentBuildContext, HostedAgentGraph } from './aidocument/contracts.js';

export type AgentFactory = (context: AgentBuildContext) => AgentGraph;

export class AgentRegistry {
  private readonly factories = new Map<string, AgentFactory>();
  private readonly aidocumentFactories = new Map<string, (context: AIDocumentAgentBuildContext) => AIDocumentAgentGraph>();
  private readonly receptionAgentVectorStoreIds: readonly string[];

  constructor(
    factories?: Record<string, AgentFactory>,
    aidocumentFactories?: Record<string, (context: AIDocumentAgentBuildContext) => AIDocumentAgentGraph>,
    options: { receptionAgentVectorStoreIds?: readonly string[] } = {},
  ) {
    this.receptionAgentVectorStoreIds = options.receptionAgentVectorStoreIds ?? [];
    this.factories.set('chat-orchestrator-poc', (context) => createChatOrchestrator(context.outputType, context.mcpServer, context.model, context.logger));
    for (const [key, factory] of Object.entries(factories ?? {})) this.factories.set(key, factory);
    this.aidocumentFactories.set('sales-agent', createSalesAgent);
    this.aidocumentFactories.set('support-agent', createSupportAgent);
    this.aidocumentFactories.set('reception-agent', (context) => createReceptionAgent({ ...context, vectorStoreIds: this.receptionAgentVectorStoreIds }));
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
    return this.hasHostedAgent(agentKey);
  }

  buildAIDocument(agentKey: string, context: AIDocumentAgentBuildContext): AIDocumentAgentGraph {
    return this.buildHostedAgent(agentKey, context);
  }

  hasHostedAgent(agentKey: string): boolean {
    return this.aidocumentFactories.has(agentKey);
  }

  buildHostedAgent(agentKey: string, context: AIDocumentAgentBuildContext): AIDocumentAgentGraph {
    const factory = this.aidocumentFactories.get(agentKey);
    if (!factory) throw new AgentNotFoundError(agentKey);
    return factory(context);
  }
}
