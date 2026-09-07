import { PrismaClient } from '@prisma/client';
import { loadEnv } from './load-env';

// 必须在 new PrismaClient() 之前灌入 process.env：连接串在构造时就读取 DATABASE_URL。
const { path: envFilePath } = loadEnv();

/** 供启动日志自证"这个进程读的是哪一份配置"。 */
export const loadedEnvFile = envFilePath;

declare global {
  // tsx watch 与 PM2 重启会重新求值本模块；不挂到 globalThis 就会攒出多个无人回收的连接池
  var __tianmaPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__tianmaPrisma ?? new PrismaClient({ log: ['warn', 'error'] });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__tianmaPrisma = prisma;
}
