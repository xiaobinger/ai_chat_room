/**
 * 闸门 1 的跨进程证据（消费端）：必须作为独立 OS 进程运行。
 *
 * 由 scripts/verify-queue.ts 拉起；也可单独跑：
 *   QUEUE_DRIVER=bullmq pnpm exec tsx scripts/queue-consumer.ts
 */
import type { RoomEvent } from '@tianma/contracts';
import { createQueue, subscribeRoomEvents, type Queue } from '@tianma/queue';
import { requireBullMQ, VERIFY_QUEUE_NAME } from './require-bullmq';

requireBullMQ();

const TIMEOUT_MS = Number(process.env.VERIFY_TIMEOUT_MS ?? 20_000);
const wantedRunId = process.argv[2];

const queue: Queue<{ runId: string }> = createQueue<{ runId: string }>(VERIFY_QUEUE_NAME);

let jobs = 0;
let events = 0;
let subscription: { close(): Promise<void> } | null = null;
let finished = false;

function finish(code: number): void {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  console.log(JSON.stringify({ role: 'consumer', driver: queue.driver, jobs, events }));
  void (async () => {
    await subscription?.close();
    await queue.close();
    process.exitCode = code;
  })();
}

const deadline = setTimeout(() => {
  console.error(`consumer timed out after ${TIMEOUT_MS}ms`);
  finish(1);
}, TIMEOUT_MS);

// 收齐"一个 job + 一条事件"即成功；两者到达顺序不定，所以两边都做一次配对检查
function settle(): void {
  if (jobs > 0 && events > 0) finish(0);
}

queue.process(async (data, name) => {
  jobs += 1;
  console.log(`JOB ${name} ${data.runId} pid=${process.pid}`);
  if (wantedRunId && data.runId !== wantedRunId) {
    console.error(`unexpected runId ${data.runId}, wanted ${wantedRunId}`);
    finish(1);
  }
  settle();
});

void subscribeRoomEvents((event: RoomEvent) => {
  events += 1;
  console.log(`EVENT ${event.event.type} ${event.roomId} pid=${process.pid}`);
  settle();
})
  .then((handle) => {
    subscription = handle;
    console.log(`consumer ready driver=${queue.driver} pid=${process.pid}`);
  })
  .catch((error: unknown) => {
    console.error('consumer failed to subscribe', error);
    finish(1);
  });
