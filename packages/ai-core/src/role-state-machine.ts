import type { RoleRunState } from '@tianma/contracts';
import type {
  AuditEntry,
  RoleEvent,
  RoleTransitionReason,
  TransitionResult,
} from './types';

/** state-machines.md §2.2，14 条合法转移，逐行照抄。 */
const EDGES: readonly (readonly [RoleRunState, RoleEvent, RoleRunState])[] = [
  ['idle', 'SELECT', 'thinking'],
  ['thinking', 'FIRST_TOKEN', 'speaking'],
  ['thinking', 'CALL_FAILED', 'error'],
  ['thinking', 'MUTE', 'muted'],
  ['speaking', 'COMPLETE_MESSAGE', 'idle'],
  ['speaking', 'OUTPUT_FAILED', 'error'],
  ['speaking', 'MUTE', 'muted'],
  ['idle', 'MUTE', 'muted'],
  ['error', 'RETRY', 'thinking'],
  ['error', 'RESET', 'idle'],
  ['muted', 'UNMUTE', 'idle'],
  ['idle', 'REMOVE', 'removed'],
  ['muted', 'REMOVE', 'removed'],
  ['error', 'REMOVE', 'removed'],
];

/** §2.1：removed 为终态，恢复只能重新添加角色。 */
export const REMOVED_TERMINAL = ['removed'] as const;

export function isRemovedRole(state: RoleRunState): boolean {
  return (REMOVED_TERMINAL as readonly string[]).includes(state);
}

export interface RoleTransitionOptions {
  /** §2.2 首行约束：SELECT 要求 Run 处于 running。缺省视为 false（失败关闭）。 */
  runRunning?: boolean;
  /** §2.2：RETRY 要求未超过重试上限。缺省视为 false（失败关闭）。 */
  retryAllowed?: boolean;
}

/**
 * 检查顺序是刻意的：终态 → 查表 → 约束。
 * 非法的 from/event 组合必须先报 `unknown_transition`，
 * 否则约束错误会掩盖状态机本身的断裂。
 */
export function roleTransition(
  from: RoleRunState,
  event: RoleEvent,
  options: RoleTransitionOptions = {},
): TransitionResult<RoleRunState, RoleTransitionReason> {
  if (isRemovedRole(from)) {
    return { ok: false, from, event, reason: 'terminal_state' };
  }
  const edge = EDGES.find(([f, e]) => f === from && e === event);
  if (!edge) {
    return { ok: false, from, event, reason: 'unknown_transition' };
  }
  if (event === 'SELECT' && !options.runRunning) {
    return { ok: false, from, event, reason: 'run_not_running' };
  }
  if (event === 'RETRY' && !options.retryAllowed) {
    return { ok: false, from, event, reason: 'retry_limit_exceeded' };
  }
  return { ok: true, from, to: edge[2] };
}

export interface RoleAuditInput {
  runId: string;
  roleId: string;
  actor: string;
  event: RoleEvent;
  from: RoleRunState;
  options?: RoleTransitionOptions;
  detail?: string;
}

export function auditRoleTransition(
  input: RoleAuditInput,
): AuditEntry<RoleRunState, RoleEvent> {
  const result = roleTransition(input.from, input.event, input.options);
  return {
    at: Date.now(),
    actor: input.actor,
    event: input.event,
    from: input.from,
    to: result.ok ? result.to : null,
    runId: input.runId,
    detail: input.detail ?? `roleId=${input.roleId}`,
    ok: result.ok,
    ...(result.ok ? {} : { reason: result.reason }),
  };
}
