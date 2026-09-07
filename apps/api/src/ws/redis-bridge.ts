import { subscribeRoomEvents, type RoomEventSubscription } from '@tianma/queue';
import { roomGateway } from './room-gateway';

/**
 * Worker → API 的事件桥。
 *
 * roomGateway 是本进程内的单例，而 Worker 是独立进程 —— 没有这座桥，
 * AI 生成的消息永远推不到浏览器（这正是修复前的状态）。
 *
 * Pub/Sub 是 fire-and-forget，所以这里丢一条不会丢数据：
 * DB 是唯一真相，客户端 (重)连时按 sequence 游标回补。
 */
export async function startRedisBridge(log: (message: string) => void): Promise<RoomEventSubscription | null> {
  if (!process.env.REDIS_URL?.trim()) {
    log('未配置 REDIS_URL：跳过事件桥。讨论仍会落库，但浏览器需靠重连回补才看得到 AI 发言');
    return null;
  }

  const subscription = await subscribeRoomEvents(
    ({ roomId, event }) => {
      if (!roomGateway.hasRoom(roomId)) return;
      roomGateway.broadcast(roomId, event);
    },
    { onError: (error, raw) => log(`事件桥收到坏载荷，已丢弃：${(error as Error).message} ${raw.slice(0, 120)}`) },
  );

  log('事件桥已启动，订阅 room:*:events');
  return subscription;
}
