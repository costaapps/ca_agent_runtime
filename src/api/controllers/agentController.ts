import type { Request, Response } from 'express';
import { AgentRunInputSchema } from '../contracts/agentRunInput.js';
import type { AgentRuntime } from '../../runtime/AgentRuntime.js';
import { AgentNotFoundError, RuntimeError } from '../../errors/RuntimeError.js';
import { ErrorCodes } from '../../errors/errorCodes.js';
import { getRuntimeHttpError } from '../tenantErrors.js';

export function createAgentController(runtime: Pick<AgentRuntime, 'run'>) {
  return async function agentRunController(request: Request, response: Response): Promise<void> {
    const parsed = AgentRunInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        Success: false,
        Output: null,
        Error: { Code: ErrorCodes.InvalidRequest, Message: 'Payload inválido.' },
      });
      return;
    }

    try {
      const result = await runtime.run(parsed.data);
      response.status(result.statusCode).json(result.response);
    } catch (error) {
      const runtimeHttpError = getRuntimeHttpError(error);
      if (runtimeHttpError) {
        response.status(runtimeHttpError.statusCode).json({
          Success: false,
          Output: null,
          Error: { Code: runtimeHttpError.code, Message: runtimeHttpError.message },
        });
        return;
      }
      if (error instanceof AgentNotFoundError) {
        response.status(422).json({
          Success: false,
          Output: null,
          Error: { Code: error.code, Message: error.message },
        });
        return;
      }
      const runtimeError = error instanceof RuntimeError ? error : new RuntimeError(ErrorCodes.AgentRuntimeError, 'Não foi possível concluir a execução.', error);
      response.status(500).json({
        Success: false,
        Output: null,
        Error: { Code: runtimeError.code, Message: 'Não foi possível concluir a execução.' },
      });
    }
  };
}
