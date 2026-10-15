import { describe, expect, it } from 'vitest';
import { compileExpectedOutput } from '../../src/runtime/ExpectedOutputCompiler.js';
import { RuntimeError } from '../../src/errors/RuntimeError.js';

describe('ExpectedOutputCompiler', () => {
  it('compiles Name and Description with string default', () => {
    const compiled = compileExpectedOutput({ Name: 'Intent', Description: 'Classifique.' });
    expect(compiled.outputType.type).toBe('json_schema');
    expect(compiled.schema).toMatchObject({ required: ['Intent'], additionalProperties: false });
    expect(compiled.validate({ Intent: 'SALES' })).toBe(true);
    expect(compiled.validate({ Intent: 1 })).toBe(false);
  });

  it('compiles AllowedValues', () => {
    const compiled = compileExpectedOutput({
      Name: 'Intent',
      Description: 'Classifique.',
      Type: 'string',
      AllowedValues: ['SALES', 'SUPPORT'],
    });
    expect(compiled.validate({ Intent: 'SALES' })).toBe(true);
    expect(compiled.validate({ Intent: 'OTHER' })).toBe(false);
  });

  it('rejects incompatible schemas before model execution', () => {
    expect(() => compileExpectedOutput({
      Name: 'Result',
      Description: 'Extraia.',
      Schema: { type: 'array', items: { type: 'string' } },
    })).toThrowError(RuntimeError);
  });

  it('supports a strict object Schema as the complete Output', () => {
    const compiled = compileExpectedOutput({
      Name: 'Result',
      Description: 'Extraia.',
      Schema: {
        type: 'object',
        properties: { Intent: { type: 'string' } },
        required: ['Intent'],
        additionalProperties: false,
      },
    });
    expect(compiled.validate({ Intent: 'SALES' })).toBe(true);
    expect(compiled.validate({ Intent: 'SALES', Other: true })).toBe(false);
  });
});
