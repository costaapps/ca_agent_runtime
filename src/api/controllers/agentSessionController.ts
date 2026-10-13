import type { Request, Response } from 'express';
import { AgentSessionCloseInputSchema } from '../contracts/agentSessionClose.js';
import type { AgentRuntime } from '../../runtime/AgentRuntime.js';
import { RuntimeError } from '../../errors/RuntimeError.js';
import { ErrorCodes } from '../../errors/errorCodes.js';
import { getTenantHttpError } from '../tenantErrors.js';

export function createAgentSessionController(runtime: Pick<AgentRuntime, 'closeSession'>) {
  return async function agentSessionController(request: Request, response: Response): Promise<void> {
    const parsed = AgentSessionCloseInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ Success: false, Error: { Code: ErrorCodes.InvalidRequest, Message: 'Payload inválido.' } });
      return;
    }
    try {
      const result = await runtime.closeSession(parsed.data);
      response.status(result.statusCode).json(result.response);
    } catch (error) {
      const tenantError = getTenantHttpError(error);
      if (tenantError) {
        response.status(tenantError.statusCode).json({ Success: false, Error: { Code: tenantError.code, Message: tenantError.message } });
        return;
      }
      const runtimeError = error instanceof RuntimeError ? error : new RuntimeError(ErrorCodes.AgentRuntimeError, 'Não foi possível fechar a Session.', error);
      response.status(500).json({ Success: false, Error: { Code: runtimeError.code, Message: runtimeError.message } });
    }
  };
}
