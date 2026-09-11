import express, { type Express } from 'express';
import type { AgentRuntime } from './runtime/AgentRuntime.js';
import { createAgentRoutes } from './api/routes/agentRoutes.js';
import { createHealthRoutes } from './api/routes/healthRoutes.js';

export function createApp(runtime: Parameters<typeof createAgentRoutes>[0]): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(createHealthRoutes());
  app.use('/v1', createAgentRoutes(runtime));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof SyntaxError) {
      response.status(400).json({
        Success: false,
        Output: null,
        Error: { Code: 'INVALID_REQUEST', Message: 'Payload inválido.' },
      });
      return;
    }
    response.status(500).json({
      Success: false,
      Output: null,
      Error: { Code: 'AGENT_RUNTIME_ERROR', Message: 'Não foi possível concluir a execução.' },
    });
  });
  return app;
}
