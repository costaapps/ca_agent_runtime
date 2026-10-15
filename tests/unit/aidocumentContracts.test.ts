import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentTurnInputSchema } from '../../src/api/contracts/agentTurnInput.js';
import { AIDocumentRootOutputSchema } from '../../src/api/contracts/agentTurnOutput.js';
import { FlowAgentInputSchema, FlowAgentOutputSchema } from '../../src/agents/aidocument/specialists/flowAgent.js';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { AgentNotFoundError } from '../../src/errors/RuntimeError.js';

describe('AIDocument contracts', () => {
  const coreActivationPayload = {
    CompanyUUID: '14ed24ea-0000-4000-8000-000000000001',
    TurnUUID: '14ed24ea-0000-4000-8000-000000000100',
    Agent: 'sales-agent',
    IdCompany: 1001,
    IdChat: 2001,
    IdProcessLine: 3001,
    TurnSource: 'ACTIVATION' as const,
    Messages: [],
    ProcessContextRevision: 7,
    ProcessContext: {
      System: { IdProcess: 5001, IdProcessLine: 3001, ModuleObject: 'AIDocument' },
      Facts: { ProductInterest: 'Memória RAM' },
      BusinessReferences: {},
      CurrentIntent: { Type: 'PRODUCT_PURCHASE' },
    },
    ActivationContext: {
      ActivationUUID: '14ed24ea-0000-4000-8000-000000000101',
      Source: 'HANDOFF' as const,
      Context: { Reason: 'Cliente deseja atendimento comercial', Summary: 'Cliente quer comprar memória RAM', TargetKind: 'MENU' },
    },
  };

  it('validates the new turn and fixed root output', () => {
    expect(AgentTurnInputSchema.safeParse({
      CompanyUUID: '14ed24ea-0000-4000-8000-000000000001',
      TurnUUID: '14ed24ea-0000-4000-8000-000000000001', Agent: 'sales-agent', IdCompany: '1003', IdChat: 123, IdProcessLine: 456,
      Messages: [{ IdMessage: 1001, Text: 'Quero comprar' }],
    }).success).toBe(true);
    const legacy = AgentTurnInputSchema.parse({
      CompanyUUID: '14ed24ea-0000-4000-8000-000000000001',
      TurnUUID: '14ed24ea-0000-4000-8000-000000000001', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456,
      Messages: [{ IdMessage: 1001, Text: 'Quero comprar' }],
    });
    expect(legacy).toMatchObject({ TurnSource: 'MESSAGE', ProcessContextRevision: 0, ActivationContext: null });
    expect(AgentTurnInputSchema.safeParse({ ...legacy, Messages: [] }).success).toBe(false);
    expect(AgentTurnInputSchema.safeParse({
      ...legacy,
      TurnSource: 'ACTIVATION',
      Messages: [],
      ActivationContext: { ActivationUUID: 'activation-1', Source: 'HANDOFF', Context: { Summary: 'Cliente escolheu vendas' } },
    }).success).toBe(true);
    expect(AgentTurnInputSchema.safeParse({ ...legacy, TurnSource: 'ACTIVATION', Messages: [] }).success).toBe(false);
    expect(AgentTurnInputSchema.safeParse({ ...coreActivationPayload, Messages: [{ IdMessage: 1, Text: 'fala real' }] }).success).toBe(false);
    expect(AgentTurnInputSchema.parse(coreActivationPayload)).toMatchObject({
      TurnSource: 'ACTIVATION', Messages: [], ProcessContextRevision: 7,
      ProcessContext: { Facts: { ProductInterest: 'Memória RAM' } },
      ActivationContext: { Source: 'HANDOFF' },
    });
    for (const source of ['MODULE_COMPLETED', 'OUTBOUND', 'QUEUED', 'SEQUENTIAL'] as const) {
      expect(AgentTurnInputSchema.safeParse({ ...coreActivationPayload, ActivationContext: { ...coreActivationPayload.ActivationContext, Source: source } }).success).toBe(true);
    }
    expect(AIDocumentRootOutputSchema.safeParse({ Response: 'Ok', Control: { CompletionRequested: false, Reason: null } }).success).toBe(true);
    expect(AIDocumentRootOutputSchema.safeParse({ Response: 'Ok', Control: { CompletionRequested: 'false' } }).success).toBe(false);
  });

  it('accepts the company configuration default and rejects a configuration code that changes the requested Agent', () => {
    const base = {
      CompanyUUID: '14ed24ea-0000-4000-8000-000000000001',
      TurnUUID: '14ed24ea-0000-4000-8000-000000000099', Agent: 'reception-agent', IdCompany: 1001, IdChat: 2001, IdProcessLine: 3001,
      Messages: [{ IdMessage: 99, Text: 'Olá' }],
    };
    expect(AgentTurnInputSchema.parse({ ...base, AgentConfiguration: { Code: 'reception-agent', Revision: 0, Instructions: '' } }).AgentConfiguration)
      .toMatchObject({ Code: 'reception-agent', Revision: 0, Instructions: '' });
    expect(AgentTurnInputSchema.safeParse({ ...base, AgentConfiguration: { Code: 'sales-agent', Revision: 1, Instructions: 'x' } }).success).toBe(false);
  });

  it('validates the optional module AgentContext without technical Flow configuration', () => {
    const base = {
      CompanyUUID: '14ed24ea-0000-4000-8000-000000000001',
      TurnUUID: '14ed24ea-0000-4000-8000-000000000199', Agent: 'sales-agent', IdCompany: 1001, IdChat: 2001, IdProcessLine: 3001,
      Messages: [{ IdMessage: 99, Text: 'Pedido' }],
    };
    const agentContext = {
      Name: 'Pedido de Venda', Objective: 'Montar um pedido.', Instructions: 'Use as capabilities disponíveis.',
      CompletionCriteria: ['Cliente definido', 'Pedido criado'],
    };
    expect(AgentTurnInputSchema.parse(base).AgentContext).toBeNull();
    expect(AgentTurnInputSchema.parse({ ...base, AgentContext: agentContext }).AgentContext).toEqual(agentContext);
    expect(AgentTurnInputSchema.safeParse({ ...base, AgentContext: { ...agentContext, Objective: '' } }).success).toBe(false);
    expect(AgentTurnInputSchema.safeParse({ ...base, AgentContext: { ...agentContext, IdProcessLineFlow: 22 } }).success).toBe(false);
  });

  it('restricts ContextUpdates to Facts and CurrentIntent', () => {
    const valid = AIDocumentRootOutputSchema.safeParse({
      Response: 'Entendi.',
      Control: {
        CompletionRequested: false,
        Reason: null,
        ContextUpdates: [
          { Namespace: 'Facts', Operation: 'SET', Key: 'ProductInterest', Value: 'Memória RAM', Source: 'USER' },
          { Namespace: 'CurrentIntent', Operation: 'SET', Key: 'Intent', Value: 'PURCHASE', Source: 'AGENT' },
          { Namespace: 'Facts', Operation: 'REMOVE', Key: 'OldFact', Value: null, Source: 'USER' },
        ],
      },
    });
    expect(valid.success).toBe(true);
    expect(AIDocumentRootOutputSchema.safeParse({
      Response: 'Não.',
      Control: { CompletionRequested: false, Reason: null, ContextUpdates: [{ Namespace: 'BusinessReferences', Operation: 'SET', Key: 'IdItem', Value: '10', Source: 'AGENT' }] },
    }).success).toBe(false);
    expect(AIDocumentRootOutputSchema.safeParse({
      Response: 'Não.',
      Control: { CompletionRequested: false, Reason: null, ContextUpdates: [{ Namespace: 'Facts', Operation: 'SET', Key: 'Fact', Value: 'x', Source: 'AGENT' }] },
    }).success).toBe(false);
    expect(AIDocumentRootOutputSchema.safeParse({
      Response: 'Não.',
      Control: { CompletionRequested: false, Reason: null, ContextUpdates: [{ Namespace: 'CurrentIntent', Operation: 'SET', Key: 'Intent', Value: 'x', Source: 'USER' }] },
    }).success).toBe(false);
    expect(AIDocumentRootOutputSchema.safeParse({
      Response: 'Não.',
      Control: { CompletionRequested: false, Reason: null, ContextUpdates: [{ Namespace: 'Facts', Operation: 'SET', Key: 'Fact', Value: { unsupported: true }, Source: 'USER' }] },
    }).success).toBe(false);
    expect(AIDocumentRootOutputSchema.safeParse({
      Response: 'Não.',
      Control: { CompletionRequested: false, Reason: null, ContextUpdates: [{ Namespace: 'BusinessReferences', Operation: 'SET', Key: 'IdItem', Value: '10', Source: 'AGENT' }] },
    }).success).toBe(false);
  });

  it('validates FlowAgent Task + optional Context and result statuses', () => {
    expect(FlowAgentInputSchema.parse({ Task: 'Consultar pedidos', Context: 'Cliente atual' })).toEqual({ Task: 'Consultar pedidos', Context: 'Cliente atual' });
    expect(FlowAgentOutputSchema.parse({ Status: 'COMPLETED', Summary: 'Concluído', Results: [{ Action: 'x', OutputJSON: '{"Id":1}', Error: null }], MissingInformation: [] })).toMatchObject({ Status: 'COMPLETED' });
    expect(FlowAgentOutputSchema.safeParse({ Status: 'COMPLETED', Summary: 'Inválido', Results: [{ Action: 'x', Output: { Id: 1 }, Error: null }], MissingInformation: [] }).success).toBe(false);
  });

  it('accepts serialized capability outputs for every JSON value shape', () => {
    const values = [{ Id: 1 }, [1, 'two'], 'texto', 42, true, null] as const;
    for (const value of values) {
      const parsed = FlowAgentOutputSchema.parse({
        Status: 'COMPLETED',
        Summary: 'Concluído',
        Results: [{ Action: 'preserve_value', OutputJSON: value === null ? null : JSON.stringify(value), Error: null }],
        MissingInformation: [],
      });
      expect(parsed.Results[0]?.OutputJSON).toBe(value === null ? null : JSON.stringify(value));
    }
  });

  it('emits a concrete structured-output schema without an open unknown field', () => {
    const schema = z.toJSONSchema(FlowAgentOutputSchema) as any;
    const resultItem = schema.properties.Results.items;
    expect(resultItem.properties).not.toHaveProperty('Output');
    expect(resultItem.properties.OutputJSON).toEqual({ type: ['string', 'null'] });
  });

  it('preserves capability errors with null OutputJSON', () => {
    expect(FlowAgentOutputSchema.parse({
      Status: 'FAILED',
      Summary: 'Falha operacional.',
      Results: [{ Action: 'find_customer', OutputJSON: null, Error: { Code: 'FLOW_ERROR', Message: 'Falhou.' } }],
      MissingInformation: [],
    })).toMatchObject({ Results: [{ Action: 'find_customer', OutputJSON: null, Error: { Code: 'FLOW_ERROR' } }] });
  });

  it('preserves NEEDS_INPUT and Candidates as the original serialized capability Output', () => {
    const output = { Status: 'AMBIGUOUS', RequestedValue: 'jadlog', Candidates: [{ Value: '12', Label: 'Jadlog' }, { Value: '18', Label: 'Jadlog Transportes' }] };
    const result = FlowAgentOutputSchema.parse({
      Status: 'NEEDS_INPUT', Summary: 'Escolha uma transportadora.',
      Results: [{ Action: 'set_carrier', OutputJSON: JSON.stringify(output), Error: null }],
      MissingInformation: ['Value'],
    });
    expect(JSON.parse(result.Results[0]!.OutputJSON!)).toEqual(output);
    expect(result.MissingInformation).toEqual(['Value']);
    expect(FlowAgentOutputSchema.parse({ ...result, Status: 'NOT_AVAILABLE' }).Status).toBe('NOT_AVAILABLE');
  });

  it('registers the AIDocument Root Agent keys separately from the legacy graph', () => {
    const registry = new AgentRegistry();
    expect(registry.has('chat-orchestrator-poc')).toBe(true);
    expect(registry.hasAIDocument('sales-agent')).toBe(true);
    expect(registry.hasAIDocument('support-agent')).toBe(true);
    expect(registry.hasAIDocument('reception-agent')).toBe(true);
    expect(registry.hasAIDocument('chat-orchestrator-poc')).toBe(false);
  });

  it('does not silently resolve an unknown AIDocument Agent', () => {
    expect(() => new AgentRegistry().buildAIDocument('unknown-agent', {} as any)).toThrow(AgentNotFoundError);
  });
});
