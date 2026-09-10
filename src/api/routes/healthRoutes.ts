import { Router } from 'express';

export function createHealthRoutes(): Router {
  const router = Router();
  router.get('/health', (_request, response) => response.json({ status: 'ok' }));
  return router;
}
