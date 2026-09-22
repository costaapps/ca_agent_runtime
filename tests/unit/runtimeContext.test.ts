import { describe, expect, it } from 'vitest';
import { createAIDocumentRuntimeContext, createRuntimeContext } from '../../src/runtime/RuntimeContext.js';
import { getContextPath, hasContextPath, mergeResolved, pickContextPaths } from '../../src/runtime/ResolvedContext.js';
import { RuntimeError } from '../../src/errors/RuntimeError.js';

const input = {
  Agent: 'chat-orchestrator-poc', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789,
  Message: 'Olá', ExpectedOutput: { Name: 'Intent', Description: 'Identifique.' },
};

describe('RuntimeContext', () => {
  it('separates immutable Execution from empty Resolved', () => {
    const context = createRuntimeContext(input, 'execution-uuid');
    expect(context.Execution).toMatchObject({ ExecutionUUID: 'execution-uuid', IdChat: 123 });
    expect(context.Resolved).toEqual({});
    expect(hasContextPath(context, 'Execution.IdChat')).toBe(true);
    expect(getContextPath(context, 'Execution.IdCompany')).toBe(1003);
  });

  it('picks only requested metadata paths', () => {
    const context = createRuntimeContext(input, 'execution-uuid');
    expect(pickContextPaths(context, ['Execution.IdChat'])).toEqual({ Execution: { IdChat: 123 } });
  });

  it('merges idempotently and protects conflicts', () => {
    const context = createRuntimeContext(input, 'execution-uuid');
    mergeResolved(context, { IdDocument: 987 });
    mergeResolved(context, { IdDocument: 987, IdCustomer: 345 });
    expect(context.Resolved).toEqual({ IdDocument: 987, IdCustomer: 345 });
    expect(() => mergeResolved(context, { IdDocument: 999 })).toThrowError(RuntimeError);
  });

  it('exposes ProcessContext and ActivationContext without mixing them into Resolved', () => {
    const context = createAIDocumentRuntimeContext({
      TurnUUID: '14ed24ea-0000-4000-8000-000000000002', Agent: 'sales-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456,
      TurnSource: 'ACTIVATION', Messages: [], ProcessContextRevision: 4,
      ProcessContext: { System: { Owner: 'Sales' }, Facts: { ProductInterest: 'RAM' }, BusinessReferences: { IdItem: 10 }, CurrentIntent: { Name: 'PURCHASE' } },
      ActivationContext: { ActivationUUID: 'activation-1', Source: 'HANDOFF', Context: { Summary: 'Continuidade' } },
    }, 'execution-uuid', 'session-uuid');
    expect(context.Execution).toMatchObject({ TurnSource: 'ACTIVATION', ProcessContextRevision: 4, ActivationUUID: 'activation-1' });
    expect(context.ProcessContext).toMatchObject({ Facts: { ProductInterest: 'RAM' }, BusinessReferences: { IdItem: 10 } });
    expect(context.ActivationContext).toMatchObject({ ActivationUUID: 'activation-1', Source: 'HANDOFF' });
    expect(context.Resolved).toEqual({});
  });
});
