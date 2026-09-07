import { BullMQQueue } from './bullmq';
import { parseRedisConnection } from './redis-connection';
import { MemoryQueue, type Queue, type QueueDriver } from './queue';

export interface QueueEnv {
  QUEUE_DRIVER?: string;
  REDIS_URL?: string;
}

/**
 * 驱动选择完全由 QUEUE_DRIVER 显式声明。
 *
 * 旧实现用 `redisUrl !== 'redis://localhost:6379'` 猜测是否启用 BullMQ ——
 * 那正是"API 与 Worker 各持一个内存队列、Run 永远不被消费"却无人察觉的成因。
 * 因此 `QUEUE_DRIVER=bullmq` 而缺 REDIS_URL 时直接抛错，绝不退回内存。
 */
export function resolveQueueDriver(env: QueueEnv = process.env): QueueDriver {
  const declared = env.QUEUE_DRIVER?.trim().toLowerCase();
  if (declared === 'bullmq') {
    if (!env.REDIS_URL?.trim()) throw new Error('queue_driver_requires_redis_url');
    return 'bullmq';
  }
  if (declared === 'memory') return 'memory';
  if (declared) throw new Error(`invalid_queue_driver: ${declared}`);
  return 'memory';
}

export interface CreateQueueOptions {
  env?: QueueEnv;
  concurrency?: number;
}

export function createQueue<T = unknown>(name: string, options: CreateQueueOptions = {}): Queue<T> {
  const env = options.env ?? process.env;
  if (resolveQueueDriver(env) === 'bullmq') {
    return new BullMQQueue<T>(name, {
      connection: parseRedisConnection(env.REDIS_URL as string),
      concurrency: options.concurrency,
    });
  }
  return new MemoryQueue<T>();
}
