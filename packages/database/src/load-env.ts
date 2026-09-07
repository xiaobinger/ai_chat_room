import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * 从 start 向上逐级查找 .env。
 * 密钥只放在仓库根，而 `pnpm --filter <pkg> dev` 会把 cwd 设到包目录，
 * 只查 cwd 会静默拿到 undefined 的连接串 —— 这正是本项目曾经"队列看起来在工作"的成因。
 */
export function findEnvFile(start: string = process.cwd()): string | null {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export interface LoadedEnv {
  path: string | null;
}

/**
 * 已存在的真实环境变量优先（dotenv 默认不覆盖），所以 PM2 / CI 注入的值
 * 一定会压过磁盘上的 .env。返回找到的文件路径，供启动日志自证读的是哪份配置。
 */
export function loadEnv(start?: string): LoadedEnv {
  const path = findEnvFile(start);
  if (path) config({ path });
  return { path };
}
