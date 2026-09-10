import { Router } from 'express';
import { createAgentController } from '../controllers/agentController.js';
import type { AgentRuntime } from '../../runtime/AgentRuntime.js';

export function createAgentRoutes(runtime: Pick<AgentRuntime, 'run'>): Router {
  const router = Router();
  router.post('/agent-runs', createAgentController(runtime));
  return router;
}
