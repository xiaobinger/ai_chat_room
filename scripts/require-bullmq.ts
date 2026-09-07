import { loadEnv } from '@tianma/database/load-env';
import { resolveQueueDriver } from '@tianma/queue';
import { RUN_QUEUE_NAME } from '@tianma/contracts';

/**
 * 队列传输验证走专用队列。
 *
 * 用真实队列名时，一个正在跑的 dev:worker 会把测试 job 抢走，
 * 于是"跨进程投递已打通"变成取决于环境状态的随机结果 —— 这个脚本就这样假失败过一次。
 * 两端是否用同一个名字由 verify:e2e 负责证明（它走的是 RUN_QUEUE_NAME）。
 *
 * 分隔符必须用连字符：BullMQ 直接拒绝名字里含冒号的队列（"Queue name cannot contain :"）。
 */
export const VERIFY_QUEUE_NAME = `${RUN_QUEUE_NAME}-verify`;

/**
 * 跨进程验证脚本的共同前置：自己灌好 .env，并拒绝在 memory 驱动下假装通过。
 * 没有这道闸，脚本会在内存队列上"成功"，而这正是当初骗过所有人的那种结果。
 */
export function requireBullMQ(): void {
  const { path } = loadEnv();
  let driver: string;
  try {
    driver = resolveQueueDriver();
  } catch (error) {
    console.error(`${(error as Error).message}（配置来源：${path ?? '未找到 .env'}）`);
    process.exit(1);
  }
  if (driver !== 'bullmq') {
    console.error(
      `需要跨进程投递，请把 QUEUE_DRIVER 设为 bullmq 并提供 REDIS_URL（配置来源：${path ?? '未找到 .env'}，当前驱动：${driver}）`,
    );
    process.exit(1);
  }
}
