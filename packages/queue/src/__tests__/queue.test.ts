import { describe, expect, it, vi } from 'vitest';
import { MemoryQueue } from '../queue';
import { createQueue, resolveQueueDriver } from '../create-queue';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('resolveQueueDriver (决策 D3)', () => {
  it('defaults to memory so a fresh clone needs no Redis', () => {
    expect(resolveQueueDriver({})).toBe('memory');
    expect(resolveQueueDriver({ REDIS_URL: 'redis://localhost:6379' })).toBe('memory');
  });

  it('honours an explicit declaration', () => {
    expect(resolveQueueDriver({ QUEUE_DRIVER: 'memory', REDIS_URL: 'redis://x:1' })).toBe('memory');
    expect(resolveQueueDriver({ QUEUE_DRIVER: ' BullMQ ', REDIS_URL: 'redis://x:1' })).toBe('bullmq');
  });

  it('refuses to silently downgrade when bullmq is asked for but Redis is missing', () => {
    expect(() => resolveQueueDriver({ QUEUE_DRIVER: 'bullmq' })).toThrow(
      'queue_driver_requires_redis_url',
    );
    expect(() => resolveQueueDriver({ QUEUE_DRIVER: 'bullmq', REDIS_URL: '  ' })).toThrow(
      'queue_driver_requires_redis_url',
    );
  });

  it('rejects a typo instead of falling back to a different driver', () => {
    expect(() => resolveQueueDriver({ QUEUE_DRIVER: 'rabbit' })).toThrow('invalid_queue_driver: rabbit');
  });
});

describe('createQueue', () => {
  it('returns the memory driver when nothing is declared', () => {
    const queue = createQueue<{ n: number }>('test-runs', { env: {} });
    expect(queue.driver).toBe('memory');
  });

  it('propagates the missing-Redis failure instead of swapping in memory', () => {
    expect(() => createQueue<{ n: number }>('test-runs', { env: { QUEUE_DRIVER: 'bullmq' } })).toThrow(
      'queue_driver_requires_redis_url',
    );
  });
});

describe('MemoryQueue', () => {
  it('delivers jobs to the registered handler with the job name', async () => {
    const queue = new MemoryQueue<{ runId: string }>();
    const seen = vi.fn();
    queue.process(async (data, name) => seen(name, data));

    await queue.add('run', { runId: 'r-1' });
    await wait(40);

    expect(seen).toHaveBeenCalledWith('run', { runId: 'r-1' });
    await queue.close();
  });

  it('holds delayed jobs until their time arrives', async () => {
    const queue = new MemoryQueue<{ n: number }>();
    const seen: number[] = [];
    queue.process(async (data) => void seen.push(data.n));

    await queue.add('run', { n: 1 }, { delay: 500 });
    await wait(60);
    expect(seen).toEqual([]);
    await queue.close();
  });

  it('dedupes a still-pending jobId so one run is not queued twice', async () => {
    const queue = new MemoryQueue<{ runId: string }>();
    const seen = vi.fn();

    // 先入队两次再注册 handler：内存队列只对尚未取走的任务去重，
    // 跨进程与历史窗口内的去重是 BullMQ jobId 的职责，不在此保证范围内
    const first = await queue.add('run', { runId: 'r-2' }, { jobId: 'r-2' });
    const second = await queue.add('run', { runId: 'r-2' }, { jobId: 'r-2' });
    expect(first.id).toBe('r-2');
    expect(second.id).toBe('r-2');

    queue.process(async (data) => seen(data.runId));
    await wait(40);
    expect(seen).toHaveBeenCalledTimes(1);
    await queue.close();
  });

  it('keeps draining the queue after a handler rejects', async () => {
    const queue = new MemoryQueue<{ n: number }>();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const done: number[] = [];
    queue.process(async (data) => {
      if (data.n === 1) throw new Error('boom');
      done.push(data.n);
    });

    await queue.add('run', { n: 1 });
    await queue.add('run', { n: 2 });
    await wait(40);

    expect(done).toEqual([2]);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
    await queue.close();
  });

  it('refuses new work once closed', async () => {
    const queue = new MemoryQueue<{ n: number }>();
    await queue.close();
    await expect(queue.add('run', { n: 1 })).rejects.toThrow('queue_closed');
  });
});
