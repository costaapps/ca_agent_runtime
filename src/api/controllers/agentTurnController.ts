import type { Request, Response } from 'express';
import { AgentTurnInputSchema } from '../contracts/agentTurnInput.js';
import type { AgentRuntime } from '../../runtime/AgentRuntime.js';
import { AgentNotFoundError, RuntimeError } from '../../errors/RuntimeError.js';
import { ErrorCodes } from '../../errors/errorCodes.js';
import { getTenantHttpError } from '../tenantErrors.js';

export function createAgentTurnController(runtime: Pick<AgentRuntime, 'runTurn'>) {
  return async function agentTurnController(request: Request, response: Response): Promise<void> {
    const parsed = AgentTurnInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ Success: false, TurnUUID: request.body?.TurnUUID, Error: { Code: ErrorCodes.InvalidRequest, Message: 'Payload inválido.' } });
      return;
    }
    try {
      const result = await runtime.runTurn(parsed.data);
      response.status(result.statusCode).json(result.response);
    } catch (error) {
      const tenantError = getTenantHttpError(error);
      if (tenantError) {
        response.status(tenantError.statusCode).json({
          Success: false,
          TurnUUID: parsed.data.TurnUUID,
          Error: { Code: tenantError.code, Message: tenantError.message },
        });
        return;
      }
      if (error instanceof AgentNotFoundError) {
        response.status(422).json({ Success: false, TurnUUID: parsed.data.TurnUUID, Error: { Code: error.code, Message: error.message } });
        return;
      }
      const runtimeError = error instanceof RuntimeError ? error : new RuntimeError(ErrorCodes.AgentExecutionError, 'Não foi possível concluir a execução.', error);
      response.status(500).json({ Success: false, TurnUUID: parsed.data.TurnUUID, Error: { Code: runtimeError.code, Message: 'Não foi possível concluir a execução.' } });
    }
  };
}
