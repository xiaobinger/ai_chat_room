import jwt from 'jsonwebtoken';

export interface AuthUser {
  id: string;
  email: string;
}

const DEFAULT_TTL = '7d';

/**
 * JWT_SECRET 缺失时**抛错**，绝不静默返回 undefined。
 * 旧实现是 `if (!secret) return;` —— 于是配置丢失时所有请求都变成"匿名且未鉴权"，
 * 而进程照常启动、测试照常全绿。
 */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw new Error('jwt_secret_not_configured');
  return secret;
}

/** 在 buildApp() 里调用一次：让配置问题在启动时炸，而不是在第一个请求上。 */
export function assertJwtConfigured(): void {
  jwtSecret();
}

export function signToken(user: AuthUser): { token: string; expiresAt: Date } {
  const expiresIn = process.env.JWT_EXPIRES_IN?.trim() || DEFAULT_TTL;
  const token = jwt.sign({ sub: user.id, email: user.email }, jwtSecret(), {
    expiresIn,
  } as jwt.SignOptions);
  const decoded = jwt.decode(token) as { exp: number } | null;
  return { token, expiresAt: new Date((decoded?.exp ?? 0) * 1000) };
}

/** 无效 / 过期 / 缺 sub 一律返回 null，由调用方决定按匿名还是 401 处理。 */
export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, jwtSecret()) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    return { id: payload.sub, email: String(payload.email ?? '') };
  } catch {
    return null;
  }
}
