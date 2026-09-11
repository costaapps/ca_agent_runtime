type Release = () => void;

type Queue = {
  active: boolean;
  waiters: Array<() => void>;
};

export class SessionMutex {
  private readonly queues = new Map<string, Queue>();

  async runExclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    const queue = this.queues.get(key) ?? { active: false, waiters: [] };
    this.queues.set(key, queue);
    await this.acquire(queue);
    try {
      return await work();
    } finally {
      this.release(key, queue);
    }
  }

  private acquire(queue: Queue): Promise<void> {
    if (!queue.active) {
      queue.active = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => queue.waiters.push(resolve));
  }

  private release(key: string, queue: Queue): void {
    const next = queue.waiters.shift();
    if (next) {
      next();
      return;
    }
    queue.active = false;
    if (this.queues.get(key) === queue) this.queues.delete(key);
  }
}
