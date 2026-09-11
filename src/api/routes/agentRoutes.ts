import { Router } from 'express';
import { createAgentController } from '../controllers/agentController.js';
import { createAgentTurnController } from '../controllers/agentTurnController.js';
import { createAgentSessionController } from '../controllers/agentSessionController.js';
import type { AgentRuntime } from '../../runtime/AgentRuntime.js';

export type AgentRuntimeHttpApi = Pick<AgentRuntime, 'run'> & Partial<Pick<AgentRuntime, 'runTurn' | 'closeSession'>>;

export function createAgentRoutes(runtime: AgentRuntimeHttpApi): Router {
  const router = Router();
  router.post('/agent-runs', createAgentController(runtime));
  if (runtime.runTurn) router.post('/agent-turns', createAgentTurnController(runtime as Pick<AgentRuntime, 'runTurn'>));
  if (runtime.closeSession) router.post('/agent-sessions/close', createAgentSessionController(runtime as Pick<AgentRuntime, 'closeSession'>));
  return router;
}
