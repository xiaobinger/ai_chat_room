import { prisma } from '@tianma/database';
import type { RoomEventSubscription } from '@tianma/queue';
import { buildApp } from './app';
import { runQueue } from './queue';
import { roomGateway } from './ws/room-gateway';
import { startRedisBridge } from './ws/redis-bridge';
import { GameDirector } from './game/game-director';

let bridge: RoomEventSubscription | null = null;
let shuttingDown: Promise<void> | null = null;

async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return shuttingDown;
  shuttingDown = (async () => {
    console.log(`[api] ${reason}，开始优雅退出`);
    // 先停止消费与广播，再关连接，最后释放 DB 池
    await runQueue.close().catch((error: unknown) => console.error('[api] queue close failed', error));
    await bridge?.close().catch((error: unknown) => console.error('[api] bridge close failed', error));
    GameDirector.disposeAll();
    roomGateway.closeAll();
    await prisma.$disconnect().catch((error: unknown) => console.error('[api] prisma close failed', error));
  })();
  await shuttingDown;
  process.exit(0);
}

// 模块作用域注册：启动过程中收到 SIGTERM（PM2 reload）也必须能退出
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

async function start(): Promise<void> {
  const app = await buildApp();
  bridge = await startRedisBridge((message) => app.log.info(message));

  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen({ port, host });
  app.log.info(`api listening on http://${host}:${port}（队列驱动=${runQueue.driver}）`);
}

void start().catch((error: unknown) => {
  console.error('[api] 启动失败', error);
  process.exit(1);
});
