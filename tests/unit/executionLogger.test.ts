import { describe, expect, it } from 'vitest';
import { ExecutionLogger } from '../../src/tracing/ExecutionLogger.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';

describe('ExecutionLogger', () => {
  it('assigns increasing sequences before persistence awaits', async () => {
    const repository = new MemoryRepository();
    const logger = new ExecutionLogger(repository, 10);
    await Promise.all([
      logger.runtimeStart(),
      logger.agentStart('ChatOrchestrator'),
      logger.runtimeEnd(3),
    ]);
    expect(repository.logs.map((entry) => entry.data.Sequence).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});
