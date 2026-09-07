import { loadEnv } from '@tianma/database/load-env';
import { RUN_QUEUE_NAME, type RunJob } from '@tianma/contracts';
import { createQueue, type Queue } from '@tianma/queue';
import { worker } from './worker';

// 本模块要读 QUEUE_DRIVER / REDIS_URL，先显式灌入 .env，不依赖 import 求值顺序
loadEnv();

/**
 * 与 apps/api/src/queue.ts 使用同一个队列名。
 * 修复前两端各自 new MemoryQueue()，跨进程永远收不到对方。
 */
export const runQueue: Queue<RunJob> = createQueue<RunJob>(RUN_QUEUE_NAME);

let closing: Promise<void> | null = null;

async function shutdown(signal: string): Promise<void> {
  if (closing) return closing;
  console.log(`[worker] ${signal}，开始优雅退出`);
  closing = (async () => {
    // BullMQ 的 close() 会等在途 job 跑完，因此不需要额外的"停止调度循环"步骤。
    // PM2 侧必须把 kill_timeout 配到大于 aiTimeoutSeconds，否则这里会被 SIGKILL 打断。
    await runQueue.close();
  })();
  await closing;
  process.exit(0);
}

runQueue.process(async (job) => {
  console.log(`[worker] 队列为 ${runQueue.driver}，收到 ${job.action} runId=${job.runId}`);
  if (job.action === 'summarize') {
    await worker.summarizeRun(job.runId);
    return;
  }
  await worker.consumeRun(job.runId);
});

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

console.log(`[worker] 启动，队列驱动=${runQueue.driver} 名称=${RUN_QUEUE_NAME}`);
