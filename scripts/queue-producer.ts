/**
 * 闸门 1 的跨进程证据（生产端）：模拟 API 进程把 Run 推入队列并广播一条房间事件。
 *
 * 由 scripts/verify-queue.ts 拉起；也可单独跑：
 *   QUEUE_DRIVER=bullmq pnpm exec tsx scripts/queue-producer.ts <runId>
 */
import { randomUUID } from 'node:crypto';
import type { RoomEvent } from '@tianma/contracts';
import { createQueue, publishRoomEvent, closeEventPublisher, type Queue } from '@tianma/queue';
import { requireBullMQ, VERIFY_QUEUE_NAME } from './require-bullmq';

requireBullMQ();

const runId = process.argv[2] ?? randomUUID();
const roomId = randomUUID();

const queue: Queue<{ runId: string }> = createQueue<{ runId: string }>(VERIFY_QUEUE_NAME);

const event: RoomEvent = {
  roomId,
  event: { type: 'pong', payload: { ts: Date.now() } },
};

void (async () => {
  // jobId = runId：同一个 Run 重复入队只会有一个任务，这是"重启后不会双跑"的前提
  const job = await queue.add('run', { runId }, { jobId: runId });
  console.log(`PRODUCED job=${job.id} runId=${runId} driver=${queue.driver} pid=${process.pid}`);
  await publishRoomEvent(event);
  console.log(`PUBLISHED roomId=${roomId} runId=${runId}`);
  await queue.close();
  await closeEventPublisher();
})().catch((error: unknown) => {
  console.error('producer failed', error);
  process.exitCode = 1;
});
