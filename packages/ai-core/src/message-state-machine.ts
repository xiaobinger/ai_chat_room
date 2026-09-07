import type { MessageStatus } from '@tianma/contracts';
import type {
  MessageEvent,
  MessageTransitionReason,
  TransitionResult,
} from './types';

/** state-machines.md §3，5 条合法转移。 */
const EDGES: ReadonlyArray<readonly [MessageStatus, MessageEvent, MessageStatus]> =
  [
    ['pending', 'START_STREAM', 'streaming'],
    ['pending', 'FAIL', 'failed'],
    ['streaming', 'COMPLETE', 'completed'],
    ['streaming', 'FAIL', 'failed'],
    ['completed', 'DELETE', 'deleted'],
  ];

export function messageTransition(
  from: MessageStatus,
  event: MessageEvent,
): TransitionResult<MessageStatus, MessageTransitionReason> {
  const edge = EDGES.find(([f, e]) => f === from && e === event);
  if (!edge) {
    return { ok: false, from, event, reason: 'unknown_transition' };
  }
  return { ok: true, from, to: edge[2] };
}

/**
 * §3：只有 completed 消息进入后续角色的正式上下文。
 * 流式片段可展示，但不得被其他角色提前引用。
 */
export function isContextEligible(status: MessageStatus): boolean {
  return status === 'completed';
}
