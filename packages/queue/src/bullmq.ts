import { Queue as BullQueue, Worker as BullWorker } from 'bullmq';
import type { EnqueueOptions, Queue, QueueDriver } from './queue';
import type { RedisConnectionOptions } from './redis-connection';

export interface BullMQQueueOptions {
  connection: RedisConnectionOptions;
  /**
   * 单进程内并发处理的 job 数。Run 调度靠 lease 保证全局单写，
   * 保持 1 以免同一进程内两个 job 争抢同一个 Run。
   */
  concurrency?: number;
}

/**
 * BullMQ 的 Queue 有 6 个类型参数，第 3 个之后的 DataType/ResultType/NameType
 * 都从第 1 个参数用条件类型反推。我们的 T 是未约束泛型，反推结果会悬置，
 * 导致 add(name: string) 报"string 不能赋给 ExtractNameType<T, string>"。
 * 这里把后三个显式钉死。
 */
type BullQueueOf<T> = BullQueue<T, void, string, T, void, string>;

export class BullMQQueue<T = unknown> implements Queue<T> {
  readonly driver: QueueDriver = 'bullmq';

  private readonly connection: RedisConnectionOptions;
  private readonly concurrency: number;
  private readonly queue: BullQueueOf<T>;
  private worker: BullWorker<T, void, string> | null = null;

  constructor(queueName: string, options: BullMQQueueOptions) {
    this.connection = options.connection;
    this.concurrency = options.concurrency ?? 1;
    this.queue = new BullQueue<T, void, string, T, void, string>(queueName, {
      connection: this.ioredisOptions(),
      // Redis 里的完成/失败集合必须有上限，否则长期运行会无界增长
      defaultJobOptions: {
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86_400, count: 5000 },
      },
    });
  }

  /**
   * BullMQ 的 Worker 靠阻塞命令取任务，ioredis 默认把 maxRetriesPerRequest
   * 设为 20；阻塞超过 20 次重连后连接被判失败，Worker 会静默停止消费。必须 null。
   */
  private ioredisOptions() {
    return { ...this.connection, maxRetriesPerRequest: null };
  }

  async add(name: string, data: T, opts?: EnqueueOptions): Promise<{ id: string }> {
    const job = await this.queue.add(name, data, {
      delay: opts?.delay,
      jobId: opts?.jobId,
      attempts: opts?.attempts,
    });
    return { id: job?.id ? String(job.id) : '' };
  }

  process(handler: (data: T, jobName: string) => Promise<void>): void {
    if (this.worker) throw new Error('queue_already_processing');
    this.worker = new BullWorker<T, void, string>(
      this.queue.name,
      async (job) => {
        await handler(job.data, job.name);
      },
      { connection: this.ioredisOptions(), concurrency: this.concurrency },
    );
  }

  async close(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
    await this.queue.close();
  }
}
