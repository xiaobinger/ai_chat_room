import { Redis, type RedisOptions } from 'ioredis';
import { RoomEventSchema, type RoomEvent } from '@tianma/contracts';
import { requireRedisConnection } from './redis-connection';

/** 每个房间一条频道，便于将来按实例分片订阅。 */
export function roomEventChannel(roomId: string): string {
  return `room:${roomId}:events`;
}

export const ROOM_EVENT_PATTERN = 'room:*:events';

/** ioredis 只接受单个 options 对象（或 url + options），不存在 (options, options) 重载。 */
function redisOptions(overrides: Partial<RedisOptions> = {}): RedisOptions {
  return { ...requireRedisConnection(), ...overrides };
}

let publisher: Redis | undefined;

export function getEventPublisher(): Redis {
  publisher ??= new Redis(redisOptions({ maxRetriesPerRequest: 2 }));
  return publisher;
}

/**
 * Worker → API 的活性提示。
 *
 * Pub/Sub 是 fire-and-forget，丢一条不会丢数据：DB 始终是唯一真相，
 * 客户端 (重)连时按 sequence 游标回补。这里只负责让"正在发生"实时可见。
 */
export async function publishRoomEvent(event: RoomEvent): Promise<void> {
  await getEventPublisher().publish(roomEventChannel(event.roomId), JSON.stringify(event));
}

export interface RoomEventSubscription {
  close(): Promise<void>;
}

export interface SubscribeOptions {
  /** 反序列化失败或载荷不合契约时回调；绝不因单条坏消息中断整个桥。 */
  onError?: (error: unknown, raw: string) => void;
}

export async function subscribeRoomEvents(
  handler: (event: RoomEvent) => void,
  options: SubscribeOptions = {},
): Promise<RoomEventSubscription> {
  // 订阅连接必须是独立实例：进入 subscriber 模式的连接不能再执行普通命令
  const subscriber = new Redis(redisOptions({ maxRetriesPerRequest: null }));

  // 模式订阅触发 pmessage(pattern, channel, payload)；message 只在精确 subscribe 时才发
  subscriber.on('pmessage', (_pattern, _channel, raw) => {
    try {
      const parsed = RoomEventSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) throw new Error('room_event_contract_mismatch');
      handler(parsed.data);
    } catch (error) {
      options.onError?.(error, raw);
    }
  });

  await subscriber.psubscribe(ROOM_EVENT_PATTERN);

  return {
    async close() {
      await subscriber.punsubscribe(ROOM_EVENT_PATTERN);
      subscriber.disconnect();
    },
  };
}

export async function closeEventPublisher(): Promise<void> {
  if (!publisher) return;
  const instance = publisher;
  publisher = undefined;
  instance.disconnect();
}
