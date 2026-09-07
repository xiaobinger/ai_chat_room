import type { RunStatus } from '@tianma/contracts';
import type {
  AuditEntry,
  RunEvent,
  RunTransitionReason,
  TransitionResult,
} from './types';

/** state-machines.md §1.2，13 条合法转移，逐行照抄。 */
const EDGES: ReadonlyArray<readonly [RunStatus, RunEvent, RunStatus]> = [
  ['draft', 'START', 'queued'],
  ['queued', 'WORKER_CLAIMED', 'running'],
  ['queued', 'CANCEL', 'terminated'],
  ['queued', 'START_FAILED', 'failed'],
  ['running', 'PAUSE', 'paused'],
  ['running', 'COMPLETE', 'completed'],
  ['running', 'TERMINATE', 'terminated'],
  ['running', 'SYSTEM_FAILURE', 'failed'],
  ['paused', 'RESUME', 'queued'],
  ['paused', 'COMPLETE', 'completed'],
  ['paused', 'TERMINATE', 'terminated'],
  ['failed', 'RETRY', 'queued'],
  ['failed', 'TERMINATE', 'terminated'],
];

/** §1.2 尾注：终态不允许原地恢复，继续讨论必须创建新 Run。 */
export const TERMINAL_RUN_STATES = ['completed', 'terminated'] as const;

export function isTerminalRunState(state: RunStatus): boolean {
  return (TERMINAL_RUN_STATES as readonly string[]).includes(state);
}

export function isLegalRunTransition(from: RunStatus, event: RunEvent): boolean {
  return EDGES.some(([f, e]) => f === from && e === event);
}

/**
 * 非法转移绝不静默成功（§2.3）。终态检查先于查表，
 * 这样 `completed` + `TERMINATE` 报 `terminal_state` 而非 `unknown_transition`。
 */
export function runTransition(
  from: RunStatus,
  event: RunEvent,
): TransitionResult<RunStatus, RunTransitionReason> {
  if (isTerminalRunState(from)) {
    return { ok: false, from, event, reason: 'terminal_state' };
  }
  const edge = EDGES.find(([f, e]) => f === from && e === event);
  if (!edge) {
    return { ok: false, from, event, reason: 'unknown_transition' };
  }
  return { ok: true, from, to: edge[2] };
}

export interface RunAuditInput {
  runId: string;
  actor: string;
  event: RunEvent;
  from: RunStatus;
  detail?: string;
}

/** 合法与非法转移都产出审计条目；非法时 to 为 null 并带上 reason。 */
export function auditRunTransition(
  input: RunAuditInput,
): AuditEntry<RunStatus, RunEvent> {
  const result = runTransition(input.from, input.event);
  return {
    at: Date.now(),
    actor: input.actor,
    event: input.event,
    from: input.from,
    to: result.ok ? result.to : null,
    runId: input.runId,
    detail: input.detail,
    ok: result.ok,
    ...(result.ok ? {} : { reason: result.reason }),
  };
}
