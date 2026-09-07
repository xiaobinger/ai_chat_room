import { describe, expect, it } from 'vitest';
import type { ModeratorRule, RoomEvent } from '@tianma/contracts';
import { RunRunner } from '../run-runner';
import { ModelCallError, type ModelProvider, type SpeakRequest } from '../model-provider';
import { UnknownModelError, type ModelResolver } from '../registry';
import { FakeStore, settings } from './helpers/fake-store';

// 治理事件要过 ModerationEventSchema，所以这些 id 必须是合法 uuid ——
// 用 "room-1" 之类的假 id 会让校验分支永远走不到，问题只会在生产暴露。
const ROOM = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const ROLE_A = '44444444-4444-4444-8444-444444444444';
const ROLE_B = '55555555-5555-4555-8555-555555555555';

function rule(overrides: Partial<ModeratorRule> & { id: string; kind: ModeratorRule['kind'] }): ModeratorRule {
  return { label: overrides.id, enabled: true, action: 'warn', safety: false, ...overrides };
}

const FORBIDDEN = rule({
  id: 'R-05',
  kind: 'forbidden_topic',
  label: '禁区话题',
  action: 'kick',
  safety: true,
  keywords: ['内幕交易'],
});

const OFF_TOPIC = rule({ id: 'R-01', kind: 'off_topic', label: '偏离主题', threshold: 0.6, action: 'remind' });

const LADDER = ['remind', 'warn', 'mute', 'kick'];

function scripted(
  text: (request: SpeakRequest, call: number) => string,
  relevance: number | null = null,
): { provider: ModelProvider; relevanceCalls: () => number } {
  let calls = 0;
  let relevanceCalls = 0;
  return {
    relevanceCalls: () => relevanceCalls,
    provider: {
      name: 'scripted',
      async speak(request) {
        calls += 1;
        return { text: text(request, calls), tokens: 20, tokensMeasured: true };
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

interface Harness {
  store: FakeStore;
  events: RoomEvent[];
  runner: RunRunner;
}

function harness(provider: ModelProvider, overrides = settings()): Harness {
  const store = new FakeStore();
  store.defaultSettings = overrides;
  const events: RoomEvent[] = [];
  const resolver: ModelResolver = { resolve: () => provider };
  const runner = new RunRunner({
    repo: store,
    registry: resolver,
    publish: (event) => {
      events.push(event);
      return Promise.resolve();
    },
    log: () => undefined,
  });
  return { store, events, runner };
}

function seed(
  store: FakeStore,
  roles: Array<{ id: string; name: string }>,
  runOverrides: Partial<{ moderatorEnabled: boolean }> = {},
): void {
  store.seedRun({
    id: RUN,
    roomId: ROOM,
    createdBy: OWNER,
    topic: '远程办公是不是伪命题',
    moderatorEnabled: runOverrides.moderatorEnabled ?? true,
  });
  store.seedRoles(roles.map((role) => ({ ...role, roomId: ROOM })));
}

const A = { id: ROLE_A, name: '甲' };
const B = { id: ROLE_B, name: '乙' };

async function runOnce(store: FakeStore, provider: ModelProvider): Promise<void> {
  const runner = new RunRunner({
    repo: store,
    registry: { resolve: () => provider },
    publish: () => Promise.resolve(),
    log: () => undefined,
  });
  await runner.consume(RUN);
}

describe('AI 管理员执行处罚阶梯', () => {
  it('同一角色反复违规时按 提醒 → 警告 → 禁言 → 移出 逐级推进', async () => {
    const provider = scripted(() => '我们来聊聊内幕交易的机会');
    const { store, runner } = harness(
      provider.provider,
      settings({ maxRounds: 20, defaultMuteRounds: 1, maxConsecutiveTurns: 10 }),
    );
    seed(store, [A]);
    store.seedPolicy(1, [FORBIDDEN], LADDER);

    await runner.consume(RUN);

    expect(store.moderationEvents.map((record) => record.event.action)).toEqual([
      'remind',
      'warn',
      'mute',
      'kick',
    ]);
    // 第 4 次违规被移出，之后不再有该角色的发言
    const states = await store.getAgentStates(RUN);
    expect(states.find((state) => state.roleId === ROLE_A)?.state).toBe('removed');
    expect(store.messages.filter((m) => m.roleId === ROLE_A && m.senderType === 'agent')).toHaveLength(4);
  });

  it('每个治理事件都带命中规则、证据、判定说明、动作、时长与规则版本（验收 #2）', async () => {
    const provider = scripted(() => '内幕交易');
    const { store } = harness(provider.provider, settings({ maxRounds: 1, defaultMuteRounds: 2 }));
    seed(store, [A]);
    store.seedPolicy(3, [FORBIDDEN], LADDER);

    const before = store.messages.length;
    await runOnce(store, provider.provider);

    const event = store.moderationEvents.at(-1);
    expect(event).toBeDefined();
    expect(event!.event).toMatchObject({
      actorType: 'moderator',
      actorId: null,
      targetType: 'role',
      targetRoleId: ROLE_A,
      matchedRule: 'R-05',
      policyVersion: 3,
      createdBy: OWNER,
      roomId: ROOM,
      runId: RUN,
      revertedAt: null,
      revertedBy: null,
    });
    expect(event!.event.evidenceMessageIds.length).toBeGreaterThan(0);
    expect(event!.event.reason).toContain('违禁词');
    // 处置说明必须进消息流，界面上才看得见"为什么被处置"
    expect(store.messages.length).toBeGreaterThan(before);
    expect(store.messages.at(-1)!.senderType).toBe('moderator');
    expect(store.messages.at(-1)!.content).toContain('R-05');
  });

  it('禁言带到期轮次，并推进阶梯游标（permissions §4）', async () => {
    const provider = scripted(() => '内幕交易');
    const { store, runner } = harness(
      provider.provider,
      settings({ maxRounds: 3, defaultMuteRounds: 2, maxConsecutiveTurns: 10 }),
    );
    seed(store, [A]);
    store.seedPolicy(1, [rule({ ...FORBIDDEN, action: 'mute' })], LADDER);

    await runner.consume(RUN);

    const mute = store.moderationEvents.find((record) => record.event.action === 'mute');
    expect(mute).toBeDefined();
    expect(mute!.event.durationRounds).toBe(2);
    expect(mute!.event.penaltyLevel).toBe(3);
    const state = (await store.getAgentStates(RUN)).find((entry) => entry.roleId === ROLE_A);
    expect(state?.state).toBe('muted');
    expect(state?.mutedUntilRound).toBeGreaterThan(0);
  });

  it('被禁言的角色在解禁前不会被导演再次选中', async () => {
    const spoken = new Set<string>();
    const provider: ModelProvider = {
      name: 'track',
      async speak(request) {
        spoken.add(request.roleName);
        return { text: `${request.roleName} 的发言`, tokens: 10, tokensMeasured: true };
      },
      async scoreRelevance() {
        return null;
      },
      async summarize() {
        return null;
      },
    };
    const { store, runner } = harness(provider, settings({ maxRounds: 3, maxConsecutiveTurns: 10 }));
    seed(store, [A, B]);
    store.seedPolicy(1, [FORBIDDEN], LADDER);
    // 直接造出"甲正被长期禁言"的既成事实（禁言由房主或上一轮处置写下）
    await store.saveAgentState(RUN, ROLE_A, { state: 'muted', mutedUntilRound: 99 });

    await runner.consume(RUN);

    expect(spoken.has('乙')).toBe(true);
    expect(spoken.has('甲')).toBe(false);
    expect(store.messages.filter((m) => m.roleId === ROLE_A && m.senderType === 'agent')).toHaveLength(0);
    // 禁言不是违规处置，治理层不该因此再生成事件
    expect(store.moderationEvents).toEqual([]);
  });
});

describe('偏题检测的取舍', () => {
  it('模型没给出相关度时弃权，绝不拿猜出来的值处罚角色', async () => {
    const provider = scripted(() => '正常发言', null);
    const { store, runner } = harness(provider.provider, settings({ maxRounds: 2 }));
    seed(store, [A]);
    store.seedPolicy(1, [OFF_TOPIC], LADDER);

    await runner.consume(RUN);

    expect(store.moderationEvents).toEqual([]);
    expect(provider.relevanceCalls()).toBeGreaterThan(0);
  });

  it('相关度低于阈值时命中 off_topic', async () => {
    const provider = scripted(() => '食堂红烧肉咸了', 0.1);
    const { store, runner } = harness(provider.provider, settings({ maxRounds: 1 }));
    seed(store, [A]);
    store.seedPolicy(1, [OFF_TOPIC], LADDER);

    await runner.consume(RUN);

    expect(store.moderationEvents.at(-1)!.event).toMatchObject({ matchedRule: 'R-01' });
    expect(store.moderationEvents.at(-1)!.event.reason).toContain('相关度');
  });

  it('策略里没有 off_topic 规则时，不该为打分多花一次模型调用', async () => {
    const provider = scripted(() => '正常发言', 0.1);
    const { store, runner } = harness(provider.provider, settings({ maxRounds: 1 }));
    seed(store, [A]);
    store.seedPolicy(1, [FORBIDDEN], LADDER);

    await runner.consume(RUN);

    expect(provider.relevanceCalls()).toBe(0);
  });
});

describe('治理的开关与容错', () => {
  it('moderatorEnabled=false 时完全不产生治理事件', async () => {
    const provider = scripted(() => '内幕交易');
    const { store, runner } = harness(provider.provider, settings({ maxRounds: 2 }));
    seed(store, [A], { moderatorEnabled: false });
    store.seedPolicy(1, [FORBIDDEN], LADDER);

    await runner.consume(RUN);

    expect(store.moderationEvents).toEqual([]);
  });

  it('没发布过策略时不做检测，也不报错', async () => {
    const provider = scripted(() => '内幕交易');
    const { store, runner } = harness(provider.provider, settings({ maxRounds: 2 }));
    seed(store, [A]);

    await runner.consume(RUN);

    expect(store.moderationEvents).toEqual([]);
    expect(store.messages.filter((m) => m.senderType === 'agent').length).toBeGreaterThan(0);
  });

  it('坏规则被忽略，讨论照常进行', async () => {
    const provider = scripted(() => '正常发言');
    const { store, runner } = harness(provider.provider, settings({ maxRounds: 2 }));
    seed(store, [A]);
    store.seedPolicy(1, [{ nonsense: true }, FORBIDDEN], LADDER);

    await runner.consume(RUN);

    expect(store.messages.filter((m) => m.senderType === 'agent').length).toBe(2);
    expect(store.moderationEvents).toEqual([]);
  });

  it('处置改变角色态时伴随 role_state 广播', async () => {
    const provider = scripted(() => '内幕交易');
    const { store, events, runner } = harness(
      provider.provider,
      settings({ maxRounds: 3, defaultMuteRounds: 1, maxConsecutiveTurns: 10 }),
    );
    seed(store, [A]);
    store.seedPolicy(1, [rule({ ...FORBIDDEN, action: 'mute' })], LADDER);

    await runner.consume(RUN);

    const moderations = events.filter((event) => event.event.type === 'moderation_event');
    const stateChanges = events.filter((event) => event.event.type === 'role_state');
    expect(moderations).toHaveLength(3);
    const statefulActions = store.moderationEvents.filter(
      (record) => record.event.action === 'mute' || record.event.action === 'kick',
    );
    expect(statefulActions.length).toBeGreaterThan(0);
    // 每次改变角色态的处置都应伴随一次角色态广播
    expect(stateChanges.length).toBeGreaterThanOrEqual(
      statefulActions.length + store.messages.filter((m) => m.senderType === 'agent').length,
    );
  });

  it('提醒与警告不改变角色调度资格（permissions §4）', async () => {
    const provider = scripted(() => '内幕交易');
    const { store, runner } = harness(provider.provider, settings({ maxRounds: 2, maxConsecutiveTurns: 10 }));
    seed(store, [A]);
    store.seedPolicy(1, [FORBIDDEN], LADDER);

    await runner.consume(RUN);

    expect(store.moderationEvents.map((record) => record.event.action)).toEqual(['remind', 'warn']);
    expect(store.messages.filter((m) => m.senderType === 'agent').length).toBe(2);
    expect((await store.getAgentStates(RUN)).find((s) => s.roleId === ROLE_A)?.state).toBe('idle');
  });
});

describe('治理不影响调度韧性', () => {
  it('角色模型名配错时既不发言也不产生治理事件', async () => {
    const store = new FakeStore();
    store.defaultSettings = settings({ maxRounds: 2 });
    store.seedRun({ id: RUN, roomId: ROOM, createdBy: OWNER, topic: '议题', moderatorEnabled: true });
    store.seedRoles([{ id: ROLE_A, roomId: ROOM, name: 'broken', modelName: 'typo' }]);
    store.seedPolicy(1, [FORBIDDEN], LADDER);

    const runner = new RunRunner({
      repo: store,
      registry: {
        resolve() {
          throw new UnknownModelError('typo', '没有模型 typo');
        },
      },
      publish: () => Promise.resolve(),
      log: () => undefined,
    });
    await runner.consume(RUN);

    expect(store.messages.filter((m) => m.senderType === 'agent')).toHaveLength(0);
    expect(store.moderationEvents).toEqual([]);
    expect((await store.getAgentStates(RUN))[0]).toMatchObject({ state: 'error' });
  });

  it('模型抛错时不产生任何发言，治理层也就无从误判', async () => {
    const provider: ModelProvider = {
      name: 'broken',
      async speak() {
        throw new ModelCallError('timeout', '超时');
      },
      async scoreRelevance() {
        return null;
      },
      async summarize() {
        return null;
      },
    };
    const store = new FakeStore();
    store.defaultSettings = settings({ maxRounds: 2, maxRetries: 0 });
    seed(store, [A]);
    store.seedPolicy(1, [FORBIDDEN], LADDER);

    await runOnce(store, provider);

    expect(store.messages.filter((m) => m.senderType === 'agent')).toHaveLength(0);
    expect(store.moderationEvents).toEqual([]);
  });
});
