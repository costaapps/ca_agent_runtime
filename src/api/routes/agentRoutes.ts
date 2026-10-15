import { Router } from 'express';
import { createAgentController } from '../controllers/agentController.js';
import { createAgentTurnController } from '../controllers/agentTurnController.js';
import { createAgentSessionController } from '../controllers/agentSessionController.js';
import type { AgentRuntime } from '../../runtime/AgentRuntime.js';
import { createFlowAssistController } from '../controllers/flowAssistController.js';

export type AgentRuntimeHttpApi = Pick<AgentRuntime, 'run'> & Partial<Pick<AgentRuntime, 'runTurn' | 'closeSession' | 'runFlowAssist'>>;

export function createAgentRoutes(runtime: AgentRuntimeHttpApi): Router {
  const router = Router();
  router.post('/agent-runs', createAgentController(runtime));
  if (runtime.runFlowAssist) router.post('/flow-assist', createFlowAssistController(runtime as Pick<AgentRuntime, 'runFlowAssist'>));
  if (runtime.runTurn) router.post('/agent-turns', createAgentTurnController(runtime as Pick<AgentRuntime, 'runTurn'>));
  if (runtime.closeSession) router.post('/agent-sessions/close', createAgentSessionController(runtime as Pick<AgentRuntime, 'closeSession'>));
  return router;
}
