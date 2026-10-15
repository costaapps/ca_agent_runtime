import { Router } from 'express';

const HEALTH_TIMEOUT_MS = 5_000;
const HEALTH_CACHE_MS = 5_000;

export interface HealthRouteOptions {
  checkRegistry?: () => Promise<void>;
  checkMcp?: () => Promise<void>;
  getPoolStats?: () => { poolCount: number; activeLeases: number; drainingPoolCount: number };
  isAccepting?: () => boolean;
}

type DependencyState = 'ok' | 'unavailable';
interface ProbeResult {
  registry: DependencyState;
  mcp: DependencyState;
  completedAt: number;
}

export function createHealthRoutes(options: HealthRouteOptions = {}): Router {
  const router = Router();
  let cached: ProbeResult | undefined;
  let cachedAt = 0;
  let inflight: Promise<ProbeResult> | undefined;

  const dependencies = async (): Promise<ProbeResult> => {
    if (!options.checkRegistry || !options.checkMcp) {
      return { registry: 'ok', mcp: 'ok', completedAt: Date.now() };
    }
    const now = Date.now();
    if (cached && now - cachedAt < HEALTH_CACHE_MS) return cached;
    if (inflight) return inflight;
    inflight = Promise.all([
      withTimeout(options.checkRegistry(), HEALTH_TIMEOUT_MS),
      withTimeout(options.checkMcp(), HEALTH_TIMEOUT_MS),
    ]).then(([registry, mcp]) => {
      const result: ProbeResult = {
        registry: registry ? 'ok' : 'unavailable',
        mcp: mcp ? 'ok' : 'unavailable',
        completedAt: Date.now(),
      };
      cached = result;
      cachedAt = Date.now();
      return result;
    }).finally(() => { inflight = undefined; });
    return inflight;
  };

  router.get('/health/live', (_request, response) => response.json({ status: 'ok' }));
  router.get('/health', (_request, response) => response.json({ status: 'ok' }));

  router.get('/health/ready', async (_request, response) => {
    if (options.isAccepting && !options.isAccepting()) {
      response.status(503).json({ status: 'unavailable' });
      return;
    }
    const result = await dependencies();
    const ready = result.registry === 'ok' && result.mcp === 'ok'
      && (!options.isAccepting || options.isAccepting());
    response.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' });
  });

  router.get('/health/dependencies', async (_request, response) => {
    const result = await dependencies();
    const accepting = !options.isAccepting || options.isAccepting();
    const pools = options.getPoolStats?.() ?? { poolCount: 0, activeLeases: 0, drainingPoolCount: 0 };
    const ready = accepting && result.registry === 'ok' && result.mcp === 'ok';
    response.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'degraded',
      accepting,
      dependencies: { registry: result.registry, mcp: result.mcp },
      pools,
    });
  });
  return router;
}

async function withTimeout(operation: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.then(() => true, () => false),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
