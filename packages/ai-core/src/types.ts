import type {
  MessageStatus,
  RoleRunState,
  RunStatus,
  RunTerminationReason,
} from '@tianma/contracts';

/** state-machines.md §1.2 的触发事件。 */
export const RUN_EVENTS = [
  'START',
  'WORKER_CLAIMED',
  'CANCEL',
  'START_FAILED',
  'PAUSE',
  'COMPLETE',
  'TERMINATE',
  'SYSTEM_FAILURE',
  'RESUME',
  'RETRY',
] as const;
export type RunEvent = (typeof RUN_EVENTS)[number];

/** state-machines.md §1.1，与 contracts 的 RunStatusSchema 同构。 */
export const RUN_STATES = [
  'draft',
  'queued',
  'running',
  'paused',
  'completed',
  'terminated',
  'failed',
] as const satisfies readonly RunStatus[];

/** state-machines.md §2.2 的触发事件。 */
export const ROLE_EVENTS = [
  'SELECT',
  'FIRST_TOKEN',
  'CALL_FAILED',
  'MUTE',
  'COMPLETE_MESSAGE',
  'OUTPUT_FAILED',
  'RETRY',
  'RESET',
  'UNMUTE',
  'REMOVE',
] as const;
export type RoleEvent = (typeof ROLE_EVENTS)[number];

/** state-machines.md §2.1，与 contracts 的 RoleRunStateSchema 同构。 */
export const ROLE_RUN_STATES = [
  'idle',
  'thinking',
  'speaking',
  'muted',
  'removed',
  'error',
] as const satisfies readonly RoleRunState[];

/** state-machines.md §3 的触发事件。 */
export const MESSAGE_EVENTS = [
  'START_STREAM',
  'COMPLETE',
  'FAIL',
  'DELETE',
] as const;
export type MessageEvent = (typeof MESSAGE_EVENTS)[number];

export const MESSAGE_STATES = [
  'pending',
  'streaming',
  'completed',
  'failed',
  'deleted',
] as const satisfies readonly MessageStatus[];

export interface TransitionOk<S extends string> {
  ok: true;
  from: S;
  to: S;
}

export interface TransitionErr<S extends string, R extends string> {
  ok: false;
  from: S;
  event: string;
  reason: R;
}

export type TransitionResult<S extends string, R extends string> =
  | TransitionOk<S>
  | TransitionErr<S, R>;

export type RunTransitionReason =
  | 'unknown_transition'
  | 'terminal_state';

export type RoleTransitionReason =
  | 'unknown_transition'
  | 'terminal_state'
  | 'run_not_running'
  | 'retry_limit_exceeded';

export type MessageTransitionReason = 'unknown_transition';

/** 状态转移审计条目（state-machines.md §2.3：非法转移也必须留痕）。 */
export interface AuditEntry<S extends string, E extends string> {
  at: number;
  actor: string;
  event: E;
  from: S;
  to: S | null;
  runId: string;
  detail?: string;
  ok: boolean;
  reason?: string;
}

export type { MessageStatus, RoleRunState, RunStatus, RunTerminationReason };
