import { publishRoomEvent } from '@tianma/queue';
import type { RoomEvent } from '@tianma/contracts';
import { loadEnv } from '@tianma/database/load-env';
import { RunRepository } from './db';
import { createModelRegistry } from './registry';
import { RunRunner } from './run-runner';

loadEnv();

export const repo = new RunRepository();
export const registry = createModelRegistry();

/**
 * 没有 REDIS_URL 就推不出事件：Worker 与 API 是两个进程，进程内的内存对象永远不会互相看见。
 * 这不至于致命 —— DB 才是唯一真相，客户端重连时按 sequence 回补；
 * 但必须说清"此时浏览器收不到实时推送"，而不是让人以为链路是通的。
 */
let warned = false;
const publish = (event: RoomEvent): Promise<void> => {
  if (!process.env.REDIS_URL?.trim()) {
    if (!warned) {
      warned = true;
      console.warn(
        '[worker] 未配置 REDIS_URL：讨论仍会正常推进并落库，但浏览器不会收到实时推送',
      );
    }
    return Promise.resolve();
  }
  return publishRoomEvent(event);
};

export const runner = new RunRunner({ repo, registry, publish });

export const worker = {
  consumeRun(runId: string): Promise<void> {
    return runner.consume(runId);
  },
  summarizeRun(runId: string): Promise<void> {
    return runner.summarizeRun(runId);
  },
};
