import { describe, expect, it } from 'vitest';
import { createRuntimeContext } from '../../src/runtime/RuntimeContext.js';
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
});
