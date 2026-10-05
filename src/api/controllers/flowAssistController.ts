import type { Request, Response } from 'express';
import { FlowAssistInputSchema } from '../contracts/flowAssistInput.js';
import type { FlowAssistRuntime } from '../../runtime/FlowAssistRuntime.js';
import { ErrorCodes } from '../../errors/errorCodes.js';

export function createFlowAssistController(runtime: Pick<FlowAssistRuntime, 'runFlowAssist'>) {
  return async function flowAssistController(request: Request, response: Response): Promise<void> {
    const parsed = FlowAssistInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ Success: false, Proposals: [], Error: { Code: ErrorCodes.InvalidRequest, Message: 'Payload inválido.' } });
      return;
    }
    const result = await runtime.runFlowAssist(parsed.data);
    response.status(result.statusCode).json(result.response);
  };
}
