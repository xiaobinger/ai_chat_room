import bcrypt from 'bcryptjs';

/**
 * bcrypt 的异步版本：cost 10 约 60ms，用同步会把整个 Fastify 事件循环堵住，
 * 登录接口因此可以成为天然的 DoS 放大器。
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}
