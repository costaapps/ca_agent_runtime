import { RuntimeError } from '../errors/RuntimeError.js';
import { ErrorCodes } from '../errors/errorCodes.js';
import type { CompiledExpectedOutput } from './ExpectedOutputCompiler.js';

export function resolveOutput(finalOutput: unknown, compiled: CompiledExpectedOutput): Record<string, unknown> {
  if (!compiled.validate(finalOutput)) {
    throw new RuntimeError(ErrorCodes.InvalidAgentOutput, 'O Agent não produziu um Output estruturado válido.');
  }
  return finalOutput;
}
