/**
 * 唯一的 HTTP 出口。
 *
 * 约定：
 * - 基地址默认 `/api/v1`，配合 vite / nginx 的同源反代；只有跨域直连时才设 VITE_API_BASE。
 * - token 只在这里读写，401 一律清空并广播出去，避免每个页面各自实现一遍登出。
 * - 非 2xx 统一抛 ApiError，带上服务端返回的 code 与 issues，界面直接按字段展示。
 */

const TOKEN_KEY = 'tianma.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly issues?: unknown,
  ) {
    super(code || `HTTP ${status}`);
    this.name = 'ApiError';
  }

  /** 后端把 zod 失败细节放在 issues 里，按 path 映射到表单字段。 */
  get issueList(): { path: string; message: string }[] {
    if (!Array.isArray(this.issues)) return [];
    return (this.issues as Record<string, unknown>[]).map((issue) => ({
      path: String(issue.path ?? '(root)'),
      message: String(issue.message ?? ''),
    }));
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** AuthContext 在挂载时注册，用于把 401 转成"回到登录页"。 */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.trim() || '/api/v1';

export async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getToken();
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401) {
    clearToken();
    unauthorizedHandler?.();
  }

  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const record = (payload ?? {}) as Record<string, unknown>;
    throw new ApiError(
      response.status,
      typeof record.error === 'string' ? record.error : `http_${response.status}`,
      record.issues,
    );
  }
  return payload as T;
}

/**
 * 浏览器发起 WS 握手时不能带自定义请求头，所以 token 走查询参数。
 * 端点在 `/api/v1/rooms/:roomId/ws`，同源反代下不需要额外配置。
 */
export function roomSocketUrl(roomId: string, token: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}${BASE}/rooms/${roomId}/ws?token=${encodeURIComponent(token)}`;
}

/** 把 ApiError 翻译成人话，供表单顶部提示使用。 */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : '未知错误';
  const labels: Record<string, string> = {
    invalid_credentials: '邮箱或密码不正确',
    email_already_registered: '这个邮箱已经注册过了',
    unauthorized: '登录已过期，请重新登录',
    forbidden: '没有权限执行这个操作',
    owner_only: '只有房主可以这样做',
    room_member_only: '需要先加入这个房间',
    private_room: '这是私有房间',
    no_speakable_agent: '还没有可发言的角色，请先添加角色',
    members_cannot_start: '房间设置不允许普通成员启动讨论',
    members_cannot_chat: '房间设置不允许普通成员发言',
    members_cannot_add_roles: '只有房主可以添加角色',
    policy_invalid: '规则配置有冲突项，请检查下方标出的字段',
    policy_version_conflict: '有人同时发布了新规则，请刷新后重试',
    kick_requires_prior_warning: '移出之前需要先有过警告或禁言',
    user_muted: '你已被房主禁言，暂时无法发言',
    unknown_transition: '当前状态不允许这个操作',
    concurrent_update: '讨论状态刚被他人改变，请重试',
    invalid_input: '填写内容有不合规的地方',
  };
  return labels[error.code] ?? error.code;
}
