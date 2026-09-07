export interface EnqueueOptions {
  /** 延迟投递毫秒数 */
  delay?: number;
  /** 幂等键：BullMQ 用它去重，同一 runId 重复入队不会产生第二个任务 */
  jobId?: string;
  /** 失败重试次数 */
  attempts?: number;
}

export type QueueDriver = 'bullmq' | 'memory';

export interface Queue<T> {
  /** 供启动日志自证实际用的是哪个驱动 —— 静默降级曾长期掩盖 API 与 Worker 断裂。 */
  readonly driver: QueueDriver;
  add(name: string, data: T, opts?: EnqueueOptions): Promise<{ id: string }>;
  process(handler: (data: T, jobName: string) => Promise<void>): void;
  close(): Promise<void>;
}

/**
 * 内存队列。仅供开发与 CI 的单进程测试：
 * 它是进程内的，Worker 与 API 各自 new 一个永远不会互相看见。
 */
export class MemoryQueue<T = unknown> implements Queue<T> {
  readonly driver = 'memory' as const;

  private readonly jobs: { id: string; name: string; data: T; delayUntil?: number }[] = [];
  private handler: ((data: T, jobName: string) => Promise<void>) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;

  async add(name: string, data: T, opts?: EnqueueOptions): Promise<{ id: string }> {
    if (this.closed) throw new Error('queue_closed');
    if (opts?.jobId && this.jobs.some((job) => job.id === opts.jobId)) {
      return { id: opts.jobId };
    }
    const id = opts?.jobId ?? `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    this.jobs.push({
      id,
      name,
      data,
      delayUntil: opts?.delay ? Date.now() + opts.delay : undefined,
    });
    this.schedule();
    return { id };
  }

  process(handler: (data: T, jobName: string) => Promise<void>): void {
    this.handler = handler;
    this.schedule();
  }

  private schedule(): void {
    if (this.closed || !this.handler || this.jobs.length === 0 || this.timer) return;

    const now = Date.now();
    const index = this.jobs.findIndex((job) => !job.delayUntil || job.delayUntil <= now);
    if (index === -1) {
      const earliest = Math.min(...this.jobs.map((job) => job.delayUntil ?? now));
      this.timer = setTimeout(() => {
        this.timer = null;
        this.schedule();
      }, Math.max(0, earliest - now));
      return;
    }

    const [job] = this.jobs.splice(index, 1);
    const handler = this.handler;
    this.timer = null;
    Promise.resolve(handler(job!.data, job!.name)).catch((error) => {
      console.error(`[queue] memory job ${job!.id} failed`, error);
    });
    setImmediate(() => this.schedule());
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
