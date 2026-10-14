import type { Request, Response } from 'express';
import { FlowAssistInputSchema } from '../contracts/flowAssistInput.js';
import type { FlowAssistRuntime } from '../../runtime/FlowAssistRuntime.js';
import { ErrorCodes } from '../../errors/errorCodes.js';
import { getRuntimeHttpError } from '../tenantErrors.js';

export function createFlowAssistController(runtime: Pick<FlowAssistRuntime, 'runFlowAssist'>) {
  return async function flowAssistController(request: Request, response: Response): Promise<void> {
    const parsed = FlowAssistInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(request.body?.Mode === 'CHECK'
        ? { Success: false, Mode: 'CHECK', Results: [], Error: { Code: ErrorCodes.InvalidRequest, Message: 'Payload inválido.' } }
        : { Success: false, Proposals: [], Error: { Code: ErrorCodes.InvalidRequest, Message: 'Payload inválido.' } });
      return;
    }
    try {
      const result = await runtime.runFlowAssist(parsed.data);
      response.status(result.statusCode).json(result.response);
    } catch (error) {
      const runtimeHttpError = getRuntimeHttpError(error);
      if (runtimeHttpError) {
        response.status(runtimeHttpError.statusCode).json(parsed.data.Mode === 'CHECK'
          ? { Success: false, Mode: 'CHECK', Results: [], Error: { Code: runtimeHttpError.code, Message: runtimeHttpError.message } }
          : { Success: false, Proposals: [], Error: { Code: runtimeHttpError.code, Message: runtimeHttpError.message } });
        return;
      }
      response.status(500).json(parsed.data.Mode === 'CHECK'
        ? { Success: false, Mode: 'CHECK', Results: [], Error: { Code: ErrorCodes.AgentRuntimeError, Message: 'Não foi possível concluir o Agent Assist.' } }
        : { Success: false, Proposals: [], Error: { Code: ErrorCodes.AgentRuntimeError, Message: 'Não foi possível concluir o Agent Assist.' } });
    }
  };
}
