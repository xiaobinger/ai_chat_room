import type { ConnectionOptions } from 'node:tls';

export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  /** rediss:// 时给 ioredis 的 TLS 选项；空对象表示用默认 TLS 参数。 */
  tls?: ConnectionOptions;
}

const DEFAULT_PORT = 6379;

/**
 * 解析 redis:// / rediss:// 连接串。
 *
 * 取代原先的 `url.split('://')[1]?.split(':')[0]` + `split(':')[2]` 写法 ——
 * 那套字符串切割会整体丢掉用户名、密码与 db 序号，并且遇到
 * `redis://user:pass@host:6379/2` 时把 `pass@host` 当成端口 parseInt 出 NaN。
 */
export function parseRedisConnection(url: string): RedisConnectionOptions {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`invalid_redis_url: ${redact(url)}`);
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (scheme !== 'redis' && scheme !== 'rediss') {
    throw new Error(`unsupported_redis_scheme: ${scheme || '(empty)'}`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (database && !/^\d+$/.test(database)) {
    throw new Error(`invalid_redis_db: ${database}`);
  }

  const options: RedisConnectionOptions = {
    host: parsed.hostname || 'localhost',
    port: parsed.port ? Number(parsed.port) : DEFAULT_PORT,
  };
  if (parsed.username) options.username = decodeURIComponent(parsed.username);
  if (parsed.password) options.password = decodeURIComponent(parsed.password);
  if (database) options.db = Number(database);
  if (scheme === 'rediss') options.tls = {};

  return options;
}

/** 报错信息可能进日志，绝不能带上密码。 */
function redact(url: string): string {
  const at = url.lastIndexOf('@');
  return at === -1 ? url : `${url.slice(0, url.indexOf('//') + 2)}***@${url.slice(at + 1)}`;
}

/** Redis 未配置时的显式失败，取代 undefined 被静默当成"不需要 Redis"。 */
export function requireRedisConnection(env: NodeJS.ProcessEnv = process.env): RedisConnectionOptions {
  const url = env.REDIS_URL?.trim();
  if (!url) throw new Error('redis_url_not_configured');
  return parseRedisConnection(url);
}
