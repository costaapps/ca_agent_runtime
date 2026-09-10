import { ErrorCodes, type ErrorCode } from './errorCodes.js';

export class RuntimeError extends Error {
  readonly code: ErrorCode | string;
  readonly causeError?: unknown;

  constructor(code: ErrorCode | string, message: string, causeError?: unknown) {
    super(message);
    this.name = 'RuntimeError';
    this.code = code;
    this.causeError = causeError;
  }
}

export class AgentNotFoundError extends RuntimeError {
  constructor(agent: string) {
    super(ErrorCodes.AgentNotFound, `Agent '${agent}' não encontrado.`);
    this.name = 'AgentNotFoundError';
  }
}

export function asRuntimeError(error: unknown, fallbackCode: ErrorCode | string = ErrorCodes.AgentRuntimeError): RuntimeError {
  if (error instanceof RuntimeError) return error;
  if (error instanceof Error) return new RuntimeError(fallbackCode, error.message, error);
  return new RuntimeError(fallbackCode, 'Erro inesperado durante a execução.', error);
}
