import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN_SETTINGS, type RoomEvent } from '@tianma/contracts';
import { ModelCallError, type ModelProvider, type SpeakRequest, type SpeakResult } from '../model-provider';
import { UnknownModelError, type ModelResolver } from '../registry';
import { RunRunner } from '../run-runner';
import { FakeStore, settings } from './helpers/fake-store';

const ROOM = 'room-1';
const RUN = 'run-1';

/** 记录型 provider：可注入失败，可观察调用次数与上下文长度。 */
function fakeProvider(
  behavior: (request: SpeakRequest, call: number) => SpeakResult = (request, call) => ({
    text: `${request.roleName} 第 ${call} 次发言`,
    tokens: 40,
    tokensMeasured: true,
  }),
  relevance: number | null = null,
): {
  provider: ModelProvider;
  calls: () => number;
  requests: () => SpeakRequest[];
  relevanceCalls: () => number;
} {
  let calls = 0;
  let relevanceCalls = 0;
  const requests: SpeakRequest[] = [];
  return {
    calls: () => calls,
    requests: () => requests,
    relevanceCalls: () => relevanceCalls,
    provider: {
      name: 'fake',
      async speak(request) {
        calls += 1;
        requests.push(request);
        return behavior(request, calls);
      },
      async scoreRelevance() {
        relevanceCalls += 1;
        return relevance;
      },
      async summarize() {
        return null;
      },
    },
  };
}

function resolverFor(provider: ModelProvider, missing = new Set<string>()): ModelResolver {
  return {
    resolve(name) {
      if (name && missing.has(name)) throw new UnknownModelError(name, `没有模型 ${name}`);
      return provider;
    },
  };
}

interface Harness {
  store: FakeStore;
  events: RoomEvent[];
  runner: RunRunner;
}

function harness(provider: ModelProvider, overrides = settings()): Harness {
  const store = new FakeStore();
  store.defaultSettings = overrides;
  const events: RoomEvent[] = [];
  const runner = new RunRunner({
    repo: store,
    registry: resolverFor(provider),
    publish: (event) => {
      events.push(event);
      return Promise.resolve();
    },
    log: () => undefined,
  });
  return { store, events, runner };
}

function seedRoundRobin(
  store: FakeStore,
  roleIds: string[],
  runOverrides: Partial<{ currentRound: number; status: 'queued' | 'running' | 'paused' }> = {},
): void {
  store.seedRun({
    id: RUN,
    roomId: ROOM,
    status: runOverrides.status ?? 'queued',
    currentRound: runOverrides.currentRound ?? 0,
  });
  store.seedRoles(roleIds.map((id) => ({ id, roomId: ROOM, name: id })));
}

describe('RunRunner 主循环', () => {
  it('让每个角色在每轮各发言一次，轮次用尽后按 round_limit 终止', async () => {
    const provider = fakeProvider();
    const { store, runner, events } = harness(provider.provider, settings({ maxRounds: 3 }));
    seedRoundRobin(store, ['a', 'b']);

    await runner.consume(RUN);

    const spoken = store.messages.filter((message) => message.senderType === 'agent');
    // 2 个角色 + 最多连发 2 轮 => 第 3 轮全员被挡下，是一个空轮。
    // 所以 3 轮预算内只有 4 条发言，缺的那两条不是丢失而是不该被产出。
    expect(spoken).toHaveLength(4);
    expect(store.messageSeq).toBe(4);
    // 序号严格递增且无重复（验收 #6 的数据侧前提）
    expect(spoken.map((message) => message.sequence)).toEqual([1, 2, 3, 4]);
    // 同一轮内不得出现同一角色两次
    const perRound = new Map<number, string[]>();
    for (const message of spoken) {
      const round = Math.floor((message.sequence - 1) / 2);
      perRound.set(round, [...(perRound.get(round) ?? []), message.roleId ?? '']);
    }
    for (const [round, roles] of perRound) {
      expect(new Set(roles).size).toBe(2);
      expect(roles[0]).not.toBe(roles[1]);
    }

    const run = store.runs.get(RUN)!;
    expect(run.status).toBe('terminated');
    expect(run.terminationReason).toBe('round_limit');
    expect(run.currentRound).toBe(3);
    expect(run.leaseToken).toBeNull();

    const last = events.filter((event) => event.event.type === 'run_status').at(-1);
    expect(last?.event).toMatchObject({
      type: 'run_status',
      payload: { status: 'terminated', terminationReason: 'round_limit' },
    });
  });

  it('每次选人都留下可审计的评分快照（mvp-spec §6）', async () => {
    const provider = fakeProvider();
    const { store, runner } = harness(provider.provider, settings({ maxRounds: 1 }));
    seedRoundRobin(store, ['a', 'b']);

    await runner.consume(RUN);

    expect(store.audits).toHaveLength(2); // 两次选人
    const audit = store.audits[0]!.payload as {
      weights: Record<string, number>;
      ranking: unknown[];
      selectedRoleId: string | null;
      selectionReason: string;
    };
    expect(Object.keys(audit.weights).sort()).toEqual([
      'budget',
      'conflict',
      'mentioned',
      'relevance',
      'silence',
    ]);
    expect(audit.ranking).toHaveLength(2);
    expect(audit.selectedRoleId).toBeTruthy();
    expect(audit.selectionReason).toBe('highest_score');
  });

  it('Run 已是 paused 时认领直接失败，不产生任何模型调用（验收 #4）', async () => {
    const provider = fakeProvider();
    const { store, runner } = harness(provider.provider);
    seedRoundRobin(store, ['a'], { status: 'paused' });

    await runner.consume(RUN);

    expect(provider.calls()).toBe(0);
    expect(store.messages).toEqual([]);
  });

  it('发言中途被暂停后，立刻停止调度且不再创建模型调用（验收 #4）', async () => {
    const provider = fakeProvider();
    const store = new FakeStore();
    let paused = false;
    const runner = new RunRunner({
      repo: store,
      registry: resolverFor(provider.provider),
      publish: () => Promise.resolve(),
      log: () => undefined,
    });
    seedRoundRobin(store, ['a', 'b']);

    // 第一次模型调用返回后模拟房主点了暂停
    const original = provider.provider.speak.bind(provider.provider);
    provider.provider.speak = async (request) => {
      const result = await original(request);
      if (!paused) {
        paused = true;
        store.patch(RUN, { status: 'paused' });
      }
      return result;
    };

    await runner.consume(RUN);

    expect(store.messages.filter((m) => m.senderType === 'agent')).toHaveLength(1);
    expect(provider.calls()).toBe(1);
    expect(store.runs.get(RUN)!.status).toBe('paused');
    // 让位时必须释放租约，否则恢复要等到超时
    expect(store.runs.get(RUN)!.leaseToken).toBeNull();
  });

  it('模型调用进行中收到暂停（租约被收回）时，那条在途发言不得落地', async () => {
    const provider = fakeProvider();
    const store = new FakeStore();
    let released = false;
    const runner = new RunRunner({
      repo: store,
      registry: resolverFor(provider.provider),
      publish: () => Promise.resolve(),
      log: () => undefined,
    });
    seedRoundRobin(store, ['a', 'b']);

    // API 暂停时会同时把 status 改成 paused 并收回 leaseToken
    const original = provider.provider.speak.bind(provider.provider);
    provider.provider.speak = async (request) => {
      const result = await original(request);
      if (!released) {
        released = true;
        store.patch(RUN, { status: 'paused' });
        store.forceRelease(RUN);
      }
      return result;
    };

    await runner.consume(RUN);

    // 只调用了一次模型，但那条结果被丢弃：暂停之后没有任何新 AI 消息
    expect(provider.calls()).toBe(1);
    expect(store.messages.filter((m) => m.senderType === 'agent')).toHaveLength(0);
    expect(store.runs.get(RUN)!.status).toBe('paused');
  });

  it('租约被别的 Worker 抢走后立即停写（§1.4 单调度 Lease）', async () => {
    const provider = fakeProvider();
    const store = new FakeStore();
    let stolen = false;
    const runner = new RunRunner({
      repo: store,
      registry: resolverFor(provider.provider),
      publish: () => Promise.resolve(),
      log: () => undefined,
    });
    seedRoundRobin(store, ['a', 'b']);

    const original = provider.provider.speak.bind(provider.provider);
    provider.provider.speak = async (request) => {
      const result = await original(request);
      if (!stolen) {
        stolen = true;
        store.stealLease(RUN);
      }
      return result;
    };

    await runner.consume(RUN);

    // 加了 speak 内部的租约复核后，易主被发现得更早：
    // 在途那条发言直接丢弃，所以一条 AI 消息都不会落地
    expect(store.messages.filter((m) => m.senderType === 'agent')).toHaveLength(0);
    expect(provider.calls()).toBe(1);
    expect(store.runs.get(RUN)!.leaseToken).toBe('other-worker');
  });

  it('token 预算用尽时按 token_budget 终止', async () => {
    const provider = fakeProvider(() => ({ text: '一段很长的发言', tokens: 100, tokensMeasured: true }));
    const { store, runner } = harness(provider.provider, settings({ tokenBudget: 150, maxRounds: 50 }));
    seedRoundRobin(store, ['a']);

    await runner.consume(RUN);

    const run = store.runs.get(RUN)!;
    expect(run.status).toBe('terminated');
    expect(run.terminationReason).toBe('token_budget');
    expect(store.messages.filter((m) => m.senderType === 'agent')).toHaveLength(2);
  });

  it('恢复的 Run 会接上已消耗的轮次与 token，不会预算清零', async () => {
    const provider = fakeProvider();
    const { store, runner } = harness(provider.provider, settings({ maxRounds: 5 }));
    seedRoundRobin(store, ['a'], { status: 'running', currentRound: 4 });
    // 上一段进程留下的消耗
    await store.appendMessage({ roomId: ROOM, runId: RUN, senderType: 'agent', roleId: 'a', content: '旧发言', tokens: 30 });

    await runner.consume(RUN);

    const run = store.runs.get(RUN)!;
    expect(run.status).toBe('terminated');
    expect(run.terminationReason).toBe('round_limit');
    // 只有第 5 轮这一次发言，而不是重新跑满 5 轮
    expect(store.messages.filter((m) => m.senderType === 'agent')).toHaveLength(2);
  });

  it('角色模型名配错时只让该角色进 error，讨论继续', async () => {
    const provider = fakeProvider();
    const store = new FakeStore();
    const events: RoomEvent[] = [];
    const runner = new RunRunner({
      repo: store,
      registry: resolverFor(provider.provider, new Set(['typo-model'])),
      publish: (event) => {
        events.push(event);
        return Promise.resolve();
      },
      log: () => undefined,
    });
    store.seedRun({ id: RUN, roomId: ROOM });
    store.seedRoles([
      { id: 'broken', roomId: ROOM, name: 'broken', modelName: 'typo-model' },
      { id: 'healthy', roomId: ROOM, name: 'healthy', modelName: 'mock' },
    ]);

    await runner.consume(RUN);

    const states = await store.getAgentStates(RUN);
    expect(states.find((state) => state.roleId === 'broken')?.state).toBe('error');
    expect(states.find((state) => state.roleId === 'healthy')?.state).toBe('idle');
    // broken 一次也没调用成模型
    expect(provider.calls()).toBeGreaterThan(0);
    // 系统提示进了消息流，界面上能看到"为什么这个人不说话了"
    expect(store.messages.some((m) => m.senderType === 'system' && m.content.includes('broken'))).toBe(true);
    expect(store.runs.get(RUN)!.status).toBe('terminated');
    expect(store.runs.get(RUN)!.terminationReason).toBe('round_limit');
  });

  it('模型调用失败会按 maxRetries 重试，然后转 error 并广播 role_state', async () => {
    const provider = fakeProvider(() => {
      throw new ModelCallError('timeout', '模型调用超过 60000ms');
    });
    const { store, runner, events } = harness(
      provider.provider,
      settings({ maxRounds: 1, maxRetries: 1 }),
    );
    seedRoundRobin(store, ['a']);

    await runner.consume(RUN);

    expect(provider.calls()).toBe(2); // 首次 + 1 次重试
    const states = await store.getAgentStates(RUN);
    expect(states[0]).toMatchObject({ state: 'error', errorCount: 1 });
    expect(events.filter((event) => event.event.type === 'role_state').at(-1)?.event).toMatchObject({
      type: 'role_state',
      payload: { state: 'error' },
    });
    // 失败不产出伪装的"内容"消息，只有一条系统提示
    expect(store.messages.every((message) => message.senderType === 'system')).toBe(true);
  });

  it('角色只失败一次时会在下一轮被系统从 error 恢复并继续发言', async () => {
    let failedOnce = false;
    const provider = fakeProvider((request, call) => {
      if (!failedOnce && request.roleName === 'a' && call <= 2) {
        failedOnce = true;
        throw new ModelCallError('empty', '端点偶发空响应');
      }
      return { text: `${request.roleName} 正常发言`, tokens: 20, tokensMeasured: true };
    });
    const { store, runner } = harness(provider.provider, settings({ maxRounds: 3, maxRetries: 0 }));
    seedRoundRobin(store, ['a', 'b']);

    await runner.consume(RUN);

    const states = await store.getAgentStates(RUN);
    const a = states.find((state) => state.roleId === 'a')!;
    expect(a.state).toBe('idle');
    // errorCount 统计的是"连续"失败：成功发言后清零。
    // 所以 ROLE_ERROR_CEILING 拦的是持续失败的角色，间歇抖动的不会被误杀。
    expect(a.errorCount).toBe(0);
    // a 既失败过也恢复并成功发言过
    expect(store.messages.filter((m) => m.roleId === 'a' && m.senderType === 'agent').length).toBeGreaterThan(0);
    expect(store.messages.some((m) => m.senderType === 'system')).toBe(true);
  });

  it('持续失败的角色到上限后不再被重试，不会无限占用调度', async () => {
    const provider = fakeProvider((request) => {
      if (request.roleName === 'a') throw new ModelCallError('http', 'HTTP 500');
      return { text: 'b 发言', tokens: 20, tokensMeasured: true };
    });
    const { store, runner } = harness(provider.provider, settings({ maxRounds: 20, maxRetries: 0 }));
    seedRoundRobin(store, ['a', 'b']);

    await runner.consume(RUN);

    const aCalls = provider.requests().filter((request) => request.roleName === 'a').length;
    expect(aCalls).toBe(3); // ROLE_ERROR_CEILING
    expect((await store.getAgentStates(RUN)).find((s) => s.roleId === 'a')).toMatchObject({
      state: 'error',
      errorCount: 3,
    });
    // b 不受影响，讨论照常跑满轮次预算
    expect(store.runs.get(RUN)!.terminationReason).toBe('round_limit');
    expect(store.messages.filter((m) => m.roleId === 'b' && m.senderType === 'agent').length).toBeGreaterThan(3);
  });

  it('禁言到期的角色在下一轮调度前自动解禁', async () => {
    const provider = fakeProvider();
    const { store, runner } = harness(provider.provider, settings({ maxRounds: 2 }));
    seedRoundRobin(store, ['a']);
    await store.ensureAgentStates(RUN, ['a']);
    await store.saveAgentState(RUN, 'a', { state: 'muted', mutedUntilRound: 0 });

    await runner.consume(RUN);

    const states = await store.getAgentStates(RUN);
    expect(states[0]).toMatchObject({ state: 'idle', mutedUntilRound: 0 });
    expect(store.messages.filter((m) => m.senderType === 'agent')).toHaveLength(2);
  });

  it('全员被禁言时推进轮次让禁言自然到期，而不是立刻判 no_available_agents', async () => {
    const provider = fakeProvider();
    const { store, runner } = harness(provider.provider, settings({ maxRounds: 10, defaultMuteRounds: 2 }));
    seedRoundRobin(store, ['a']);
    await store.ensureAgentStates(RUN, ['a']);
    await store.saveAgentState(RUN, 'a', { state: 'muted', mutedUntilRound: 2 });

    await runner.consume(RUN);

    // 第 2 轮到期后恢复发言，因此不会以 no_available_agents 收场
    expect(store.runs.get(RUN)!.terminationReason).not.toBe('no_available_agents');
    expect(store.messages.filter((m) => m.senderType === 'agent').length).toBeGreaterThan(0);
  });

  it('房间内没有角色时以 no_available_agents 终止', async () => {
    const provider = fakeProvider();
    const { store, runner } = harness(provider.provider);
    store.seedRun({ id: RUN, roomId: ROOM });

    await runner.consume(RUN);

    expect(store.runs.get(RUN)!.terminationReason).toBe('no_available_agents');
    expect(provider.calls()).toBe(0);
  });

  it('settings 非法时转 failed 而不是带病运行', async () => {
    const provider = fakeProvider();
    const store = new FakeStore();
    const events: RoomEvent[] = [];
    const runner = new RunRunner({
      repo: store,
      registry: resolverFor(provider.provider),
      publish: (event) => {
        events.push(event);
        return Promise.resolve();
      },
      log: () => undefined,
    });
    store.seedRun({ id: RUN, roomId: ROOM });
    store.patch(RUN, { settings: { ...DEFAULT_RUN_SETTINGS, maxRounds: 999 } });

    await runner.consume(RUN);

    expect(store.runs.get(RUN)!.status).toBe('failed');
    expect(provider.calls()).toBe(0);
    expect(events.some((event) => event.event.type === 'error')).toBe(true);
  });

  it('传给模型的 maxTokens 与超时来自 Run settings', async () => {
    const provider = fakeProvider();
    const { store, runner } = harness(
      provider.provider,
      settings({ maxRounds: 1, maxTokensPerMessage: 123, aiTimeoutSeconds: 7 }),
    );
    seedRoundRobin(store, ['a']);

    await runner.consume(RUN);

    expect(provider.requests()[0]).toMatchObject({ maxTokens: 123, timeoutMs: 7000 });
  });
});
