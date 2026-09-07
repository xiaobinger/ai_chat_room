import { loadEnv } from '@tianma/database/load-env';
import { RUN_QUEUE_NAME, type RunJob } from '@tianma/contracts';
import { createQueue, type Queue } from '@tianma/queue';

// 本模块要读 QUEUE_DRIVER / REDIS_URL，先显式灌入 .env，不依赖 import 求值顺序
loadEnv();

/**
 * API 只生产，不消费。
 * 修复前这里是 `new MemoryQueue()`，与 Worker 进程里的另一个 MemoryQueue 互不相识，
 * Run 入队后就地蒸发。现在两端都用 RUN_QUEUE_NAME，经 Redis / BullMQ 交接。
 */
export const runQueue: Queue<RunJob> = createQueue<RunJob>(RUN_QUEUE_NAME);
