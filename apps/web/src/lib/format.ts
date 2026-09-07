import type { CSSProperties } from 'react';

export function relativeTime(input: Date | string | null | undefined): string {
  if (!input) return '';
  const at = typeof input === 'string' ? Date.parse(input) : input.getTime();
  if (!Number.isFinite(at)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 45) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86_400)} 天前`;
}

export function tokenLabel(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k` : String(tokens);
}

/** 预算条的宽度；服务端已把比例夹在 [0,1]，这里只防除零。 */
export function ratioPercent(used: number, budget: number): number {
  if (budget <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / budget) * 100)));
}

const RUN_STATE_LABELS: Record<string, string> = {
  idle: '待命',
  thinking: '思考中',
  speaking: '正在发言',
  muted: '已禁言',
  removed: '已移出',
  error: '调用失败',
};

export function runStateLabel(state: string | undefined): string {
  return (state && RUN_STATE_LABELS[state]) || '待命';
}

const ROOM_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  idle: '空闲',
  running: '进行中',
  paused: '已暂停',
  ended: '已结束',
  archived: '已归档',
};

export function roomStatusLabel(status: string | undefined): string {
  return (status && ROOM_STATUS_LABELS[status]) || status || '';
}

const TERMINATION_LABELS: Record<string, string> = {
  round_limit: '达到轮次上限',
  token_budget: 'Token 预算耗尽',
  cost_budget: '费用预算耗尽',
  time_limit: '超时',
  repetition_loop: '重复循环',
  safety_violation: '安全规则触发',
  no_available_agents: '没有可发言的角色',
  owner_terminated: '房主终止',
  user_cancelled: '已取消',
};

export function terminationLabel(reason: string | null | undefined): string {
  return (reason && TERMINATION_LABELS[reason]) || reason || '';
}

const ACTION_LABELS: Record<string, string> = {
  remind: '提醒',
  warn: '警告',
  mute: '限时禁言',
  kick: '移出',
  revoke: '撤销',
};

export function actionLabel(action: string | undefined): string {
  return (action && ACTION_LABELS[action]) || action || '';
}

/** 角色头像底色：优先用房间配置的颜色，否则按序号给一个稳定色。 */
const FALLBACK_TONES = ['purple', 'blue', 'orange'];

export function toneFor(index: number): string {
  return FALLBACK_TONES[index % FALLBACK_TONES.length] ?? 'purple';
}

/** App.css 里 .avatar.<tone> 是写死的 class；角色带了自定义颜色时用内联样式盖掉它。 */
export function avatarStyle(color: string | null | undefined): CSSProperties {
  return color ? { background: color } : {};
}
