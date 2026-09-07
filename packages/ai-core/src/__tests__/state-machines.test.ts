import { describe, expect, it } from 'vitest';
import {
  auditRunTransition,
  isTerminalRunState,
  runTransition,
} from '../run-state-machine';
import {
  auditRoleTransition,
  REMOVED_TERMINAL,
  roleTransition,
} from '../role-state-machine';
import {
  isContextEligible,
  messageTransition,
} from '../message-state-machine';

describe('run state machine (state-machines.md §1.2)', () => {
  const legal: Array<[Parameters<typeof runTransition>[0], Parameters<typeof runTransition>[1], string]> = [
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

  it.each(legal)('%s + %s -> %s', (from, event, to) => {
    expect(runTransition(from, event)).toEqual({ ok: true, from, to });
  });

  it('has exactly 13 legal edges', () => {
    expect(legal).toHaveLength(13);
  });

  it('rejects transitions outside the table', () => {
    expect(runTransition('draft', 'PAUSE')).toEqual({
      ok: false,
      from: 'draft',
      event: 'PAUSE',
      reason: 'unknown_transition',
    });
    expect(runTransition('running', 'RESUME').ok).toBe(false);
    expect(runTransition('queued', 'PAUSE').ok).toBe(false);
  });

  it('treats completed and terminated as terminal and reports terminal_state first', () => {
    expect(isTerminalRunState('completed')).toBe(true);
    expect(isTerminalRunState('terminated')).toBe(true);
    expect(isTerminalRunState('failed')).toBe(false);
    // RESUME 对 completed 本就不在表里，但终态检查优先，reason 必须是 terminal_state
    expect(runTransition('completed', 'RESUME')).toMatchObject({ reason: 'terminal_state' });
    expect(runTransition('terminated', 'TERMINATE')).toMatchObject({ reason: 'terminal_state' });
  });

  it('audits both accepted and rejected transitions', () => {
    const ok = auditRunTransition({
      runId: 'run-1',
      actor: 'user-1',
      event: 'PAUSE',
      from: 'running',
      detail: '房主暂停',
    });
    expect(ok).toMatchObject({ ok: true, to: 'paused', runId: 'run-1', detail: '房主暂停' });
    expect(ok.at).toBeGreaterThan(0);

    const bad = auditRunTransition({ runId: 'run-1', actor: 'user-1', event: 'RETRY', from: 'running' });
    expect(bad).toMatchObject({ ok: false, to: null, reason: 'unknown_transition' });
  });
});

describe('role state machine (state-machines.md §2.2)', () => {
  it('allows SELECT only when the run is running', () => {
    expect(roleTransition('idle', 'SELECT')).toMatchObject({ ok: false, reason: 'run_not_running' });
    expect(roleTransition('idle', 'SELECT', { runRunning: false })).toMatchObject({
      ok: false,
      reason: 'run_not_running',
    });
    expect(roleTransition('idle', 'SELECT', { runRunning: true })).toEqual({
      ok: true,
      from: 'idle',
      to: 'thinking',
    });
  });

  it('gates RETRY on the retry allowance', () => {
    expect(roleTransition('error', 'RETRY')).toMatchObject({ ok: false, reason: 'retry_limit_exceeded' });
    expect(roleTransition('error', 'RETRY', { retryAllowed: true })).toEqual({
      ok: true,
      from: 'error',
      to: 'thinking',
    });
  });

  it('reports unknown_transition before constraint failures', () => {
    // thinking + SELECT 不在表里，不能因为缺 runRunning 就报 run_not_running
    expect(roleTransition('thinking', 'SELECT')).toMatchObject({ reason: 'unknown_transition' });
  });

  it('walks the full speak cycle', () => {
    const options = { runRunning: true };
    expect(roleTransition('idle', 'SELECT', options).ok).toBe(true);
    expect(roleTransition('thinking', 'FIRST_TOKEN').ok).toBe(true);
    expect(roleTransition('speaking', 'COMPLETE_MESSAGE').ok).toBe(true);
    expect(roleTransition('thinking', 'MUTE')).toEqual({ ok: true, from: 'thinking', to: 'muted' });
    expect(roleTransition('speaking', 'MUTE')).toEqual({ ok: true, from: 'speaking', to: 'muted' });
    expect(roleTransition('muted', 'UNMUTE')).toEqual({ ok: true, from: 'muted', to: 'idle' });
  });

  it('removes from idle/muted/error and nothing else', () => {
    for (const from of ['idle', 'muted', 'error'] as const) {
      expect(roleTransition(from, 'REMOVE')).toEqual({ ok: true, from, to: 'removed' });
    }
    for (const from of ['thinking', 'speaking'] as const) {
      expect(roleTransition(from, 'REMOVE').ok).toBe(false);
    }
    expect(REMOVED_TERMINAL).toEqual(['removed']);
    expect(roleTransition('removed', 'UNMUTE')).toMatchObject({ reason: 'terminal_state' });
    expect(roleTransition('removed', 'SELECT', { runRunning: true })).toMatchObject({
      reason: 'terminal_state',
    });
  });

  it('audits role transitions with the roleId', () => {
    const entry = auditRoleTransition({
      runId: 'run-1',
      roleId: 'role-a',
      actor: 'moderator',
      event: 'MUTE',
      from: 'idle',
    });
    expect(entry).toMatchObject({ ok: true, to: 'muted', actor: 'moderator', detail: 'roleId=role-a' });
  });
});

describe('message state machine (state-machines.md §3)', () => {
  it('walks pending -> streaming -> completed', () => {
    expect(messageTransition('pending', 'START_STREAM')).toEqual({ ok: true, from: 'pending', to: 'streaming' });
    expect(messageTransition('streaming', 'COMPLETE')).toEqual({ ok: true, from: 'streaming', to: 'completed' });
    expect(messageTransition('completed', 'DELETE')).toEqual({ ok: true, from: 'completed', to: 'deleted' });
  });

  it('fails from pending or streaming', () => {
    expect(messageTransition('pending', 'FAIL').ok).toBe(true);
    expect(messageTransition('streaming', 'FAIL').ok).toBe(true);
    expect(messageTransition('completed', 'FAIL')).toMatchObject({ ok: false });
  });

  it('has no path back out of failed or deleted', () => {
    expect(messageTransition('failed', 'COMPLETE').ok).toBe(false);
    expect(messageTransition('deleted', 'START_STREAM').ok).toBe(false);
    expect(messageTransition('streaming', 'DELETE')).toMatchObject({ reason: 'unknown_transition' });
  });

  it('only lets completed messages into other roles context', () => {
    expect(isContextEligible('completed')).toBe(true);
    for (const status of ['pending', 'streaming', 'failed', 'deleted'] as const) {
      expect(isContextEligible(status)).toBe(false);
    }
  });
});
