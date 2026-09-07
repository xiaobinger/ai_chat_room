import './setup-env';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { appendRoomMessage, prisma, type Prisma } from '@tianma/database';
import { buildApp } from '../app';

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emailFor = (name: string): string => `${name}.${suffix}@apitest.dev`;
const PASSWORD = 'test-password-123';

let app: FastifyInstance;
const createdUserIds: string[] = [];

interface Session {
  id: string;
  email: string;
  token: string;
}

async function register(name: string): Promise<Session> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: emailFor(name), password: PASSWORD, displayName: `测试用户 ${name}` },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json() as { token: string; user: { id: string } };
  const session = { id: body.user.id, email: emailFor(name), token: body.token };
  createdUserIds.push(session.id);
  return session;
}

function call(method: string, url: string, session?: Session, body?: unknown) {
  const options: InjectOptions = {
    method: method as InjectOptions['method'],
    url,
    headers: session ? { authorization: `Bearer ${session.token}` } : {},
  };
  // 不传 body 时不要写 payload: undefined，否则 GET 也会带上空体
  if (body !== undefined) options.payload = body as InjectOptions['payload'];
  return app.inject(options);
}

async function createRoom(owner: Session, overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await call('POST', '/api/v1/rooms', owner, {
    title: `测试房间 ${suffix}`,
    mode: 'structured',
    ...overrides,
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string }).id;
}

async function addRole(session: Session, roomId: string, name: string): Promise<string> {
  const response = await call('POST', `/api/v1/rooms/${roomId}/roles`, session, {
    name,
    type: 'debater',
    systemPrompt: '你是测试角色，请用一句话回应上一条发言。',
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string }).id;
}

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  if (createdUserIds.length > 0) {
    // 按外键安全顺序清理：createdBy 上是 Restrict，先删引用再删用户
    await prisma.moderationEvent.deleteMany({ where: { OR: [{ createdBy: { in: createdUserIds } }, { revertedBy: { in: createdUserIds } }, { actorId: { in: createdUserIds } }] } });
    await prisma.moderatorPolicy.deleteMany({ where: { createdBy: { in: createdUserIds } } });
    await prisma.discussionRun.deleteMany({ where: { createdBy: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe('注册与登录', () => {
  it('注册返回 token 与不含凭据的用户视图', async () => {
    const session = await register('basic');
    const me = await call('GET', '/api/v1/auth/me', session);
    expect(me.statusCode).toBe(200);
    const body = me.json() as Record<string, unknown>;
    expect(body.id).toBe(session.id);
    expect(body.email).toBe(session.email);
    expect(body).not.toHaveProperty('passwordHash');
  });

  it('响应体里绝不出现 passwordHash', async () => {
    const raw = await call('POST', '/api/v1/auth/login', undefined, { email: emailFor('basic'), password: PASSWORD });
    expect(raw.statusCode).toBe(200);
    expect(raw.body).not.toContain('passwordHash');
    expect(raw.body).not.toContain('$2a$');
  });

  it('重复邮箱返回 409，而不是把已有账号再注册一遍', async () => {
    await register('dupe');
    const second = await call('POST', '/api/v1/auth/register', undefined, {
      email: emailFor('dupe'),
      password: PASSWORD,
      displayName: '另一个人',
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: 'email_already_registered' });
  });

  it('密码过短直接拒掉', async () => {
    const response = await call('POST', '/api/v1/auth/register', undefined, {
      email: emailFor('weak'),
      password: '123',
      displayName: '弱密码',
    });
    expect(response.statusCode).toBe(400);
  });

  it('错误口令与不存在的邮箱给出完全相同的响应，避免用户名枚举', async () => {
    const session = await register('enum');
    const wrongPassword = await call('POST', '/api/v1/auth/login', undefined, {
      email: session.email,
      password: 'definitely-wrong',
    });
    const noSuchUser = await call('POST', '/api/v1/auth/login', undefined, {
      email: emailFor('nobody'),
      password: PASSWORD,
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(noSuchUser.statusCode).toBe(401);
    expect(noSuchUser.json()).toEqual(wrongPassword.json());
  });
});

describe('鉴权与授权', () => {
  it('未登录拿不到任何房间数据', async () => {
    expect((await call('GET', '/api/v1/rooms')).statusCode).toBe(401);
    const session = await register('listguard');
    const created = await createRoom(session);
    expect((await call('GET', `/api/v1/rooms/${created}`)).statusCode).toBe(401);
    expect((await call('GET', `/api/v1/rooms/${created}/messages`)).statusCode).toBe(401);
  });

  it('房主身份只来自 JWT，请求体里的 ownerId 被忽略', async () => {
    const owner = await register('owner');
    const attacker = await register('attacker');

    const response = await call('POST', '/api/v1/rooms', owner, {
      title: '身份伪造尝试',
      mode: 'free',
      ownerId: attacker.id,
    });
    expect(response.statusCode).toBe(201);
    const room = await prisma.room.findUnique({ where: { id: (response.json() as { id: string }).id } });
    expect(room?.ownerId).toBe(owner.id);
    expect(room?.ownerId).not.toBe(attacker.id);
  });

  it('私有房间对非成员不可见，申请 + 房主批准后可见', async () => {
    const owner = await register('priv-owner');
    const stranger = await register('priv-stranger');
    const roomId = await createRoom(owner, { visibility: 'private' });

    expect((await call('GET', `/api/v1/rooms/${roomId}`, stranger)).statusCode).toBe(403);

    const join = await call('POST', `/api/v1/rooms/${roomId}/join`, stranger, { intent: 'discuss' });
    expect(join.statusCode).toBe(201);
    const membershipId = (join.json() as { id: string }).id;

    // 没批准之前仍然是 403
    expect((await call('GET', `/api/v1/rooms/${roomId}`, stranger)).statusCode).toBe(403);

    // 审批人身份来自 JWT：申请者不能把自己批准了
    const selfApprove = await call(
      'POST',
      `/api/v1/rooms/${roomId}/memberships/${membershipId}/approve`,
      stranger,
      {},
    );
    expect(selfApprove.statusCode).toBe(403);

    const approve = await call(
      'POST',
      `/api/v1/rooms/${roomId}/memberships/${membershipId}/approve`,
      owner,
      {},
    );
    expect(approve.statusCode).toBe(200);
    expect((approve.json() as { status: string }).status).toBe('approved');
    expect((await call('GET', `/api/v1/rooms/${roomId}`, stranger)).statusCode).toBe(200);
  });

  it('公开房间仍要求登录，但非成员可以浏览', async () => {
    const owner = await register('pub-owner');
    const visitor = await register('pub-visitor');
    const roomId = await createRoom(owner, { visibility: 'public' });
    expect((await call('GET', `/api/v1/rooms/${roomId}`)).statusCode).toBe(401);
    expect((await call('GET', `/api/v1/rooms/${roomId}`, visitor)).statusCode).toBe(200);
    // 但浏览不等于能发言
    expect((await call('POST', `/api/v1/rooms/${roomId}/messages`, visitor, { content: '路过' })).statusCode).toBe(403);
  });

  it('发言身份由服务端决定，请求体伪装 agent / 他人一律无效', async () => {
    const owner = await register('msg-owner');
    const victim = await register('msg-victim');
    const roomId = await createRoom(owner);
    const roleId = await addRole(owner, roomId, '伪装测试角色');

    const response = await call('POST', `/api/v1/rooms/${roomId}/messages`, owner, {
      content: '看起来很像是 AI 说的',
      senderType: 'agent',
      senderId: victim.id,
      roleId,
    });
    expect(response.statusCode).toBe(201);

    const stored = await prisma.message.findUnique({ where: { id: (response.json() as { id: string }).id } });
    expect(stored?.senderType).toBe('user');
    expect(stored?.senderId).toBe(owner.id);
    // 人类消息不能占用某个 AI 角色的身份
    expect(stored?.roleId).toBeNull();
  });

  it('消息序号由房间级原子计数器发出，连续且不重复', async () => {
    const owner = await register('seq-owner');
    const roomId = await createRoom(owner);
    const before = (await prisma.room.findUniqueOrThrow({ where: { id: roomId }, select: { messageSeq: true } })).messageSeq;

    const sent = await Promise.all(
      Array.from({ length: 8 }, (_unused, index) =>
        call('POST', `/api/v1/rooms/${roomId}/messages`, owner, { content: `并发消息 ${index}` }),
      ),
    );
    expect(sent.every((response) => response.statusCode === 201)).toBe(true);

    const rows = await prisma.message.findMany({ where: { roomId }, orderBy: { sequence: 'asc' } });
    expect(rows).toHaveLength(8);
    expect(rows.map((row) => row.sequence)).toEqual(
      Array.from({ length: 8 }, (_unused, index) => before + index + 1),
    );

    const backfill = await call('GET', `/api/v1/rooms/${roomId}/messages?after=${rows[2]!.sequence}`, owner);
    expect(backfill.statusCode).toBe(200);
    const fetched = backfill.json() as { sequence: number }[];
    expect(fetched[0]!.sequence).toBe(rows[2]!.sequence + 1);
    expect(fetched).toHaveLength(5);
  });

  it('membersCanAddRoles 关闭时普通成员不能加角色，房主可以', async () => {
    const owner = await register('role-owner');
    const member = await register('role-member');
    const roomId = await createRoom(owner);
    const join = await call('POST', `/api/v1/rooms/${roomId}/join`, member, {});
    await call('POST', `/api/v1/rooms/${roomId}/memberships/${(join.json() as { id: string }).id}/approve`, owner, {});

    expect((await addRoleFails(member, roomId)).statusCode).toBe(403);
    const enabled = await call('POST', `/api/v1/rooms/${roomId}/roles`, owner, {
      name: '房主添加',
      type: 'debater',
      systemPrompt: '测试',
    });
    expect(enabled.statusCode).toBe(201);
  });
});

async function addRoleFails(session: Session, roomId: string) {
  return call('POST', `/api/v1/rooms/${roomId}/roles`, session, {
    name: '成员越权添加',
    type: 'debater',
    systemPrompt: '测试',
  });
}

describe('Run 控制', () => {
  it('启动会快照默认设置并入队；控制动作走状态机而非客户端指定状态', async () => {
    const owner = await register('run-owner');
    const roomId = await createRoom(owner);
    await addRole(owner, roomId, '甲');

    const started = await call('POST', `/api/v1/rooms/${roomId}/start`, owner, { topic: 'AI 是否应该有创作自主权' });
    expect(started.statusCode).toBe(201);
    const run = started.json() as { id: string; status: string; settings: Record<string, number> };
    expect(run.status).toBe('queued');
    expect(run.settings.maxRounds).toBe(20);
    expect(run.settings.tokenBudget).toBe(12_000);

    // queued 上不能直接 pause（§1.2 没有这条边）
    const badPause = await call('POST', `/api/v1/rooms/${roomId}/runs/${run.id}/commands`, owner, { command: 'pause' });
    expect(badPause.statusCode).toBe(409);
    expect(badPause.json()).toMatchObject({ error: 'unknown_transition' });

    const cancel = await call('POST', `/api/v1/rooms/${roomId}/runs/${run.id}/commands`, owner, { command: 'cancel' });
    expect(cancel.statusCode).toBe(200);
    const cancelled = cancel.json() as { status: string; terminationReason: string };
    expect(cancelled.status).toBe('terminated');
    expect(cancelled.terminationReason).toBe('user_cancelled');

    // 终态不可原地恢复
    expect((await call('POST', `/api/v1/rooms/${roomId}/runs/${run.id}/commands`, owner, { command: 'resume' })).statusCode).toBe(409);
  });

  it('允许自定义设置但硬顶 100 轮必须生效', async () => {
    const owner = await register('settings-owner');
    const roomId = await createRoom(owner);
    await addRole(owner, roomId, '甲');

    const tooBig = await call('POST', `/api/v1/rooms/${roomId}/start`, owner, {
      topic: '超上限',
      settings: { maxRounds: 101 },
    });
    expect(tooBig.statusCode).toBe(400);

    const ok = await call('POST', `/api/v1/rooms/${roomId}/start`, owner, {
      topic: '在范围内',
      settings: { maxRounds: 5, tokenBudget: 500 },
    });
    expect(ok.statusCode).toBe(201);
    const settings = (ok.json() as { settings: Record<string, number> }).settings;
    expect(settings.maxRounds).toBe(5);
    // 未提供的字段必须回落到默认快照，而不是变成 undefined 写进库
    expect(settings.maxConsecutiveTurns).toBe(2);
  });

  it('跨房间读取别人的 run 是 404，不是 200', async () => {
    const alice = await register('run-alice');
    const bob = await register('run-bob');
    const aliceRoom = await createRoom(alice);
    const bobRoom = await createRoom(bob);
    await addRole(alice, aliceRoom, '甲');
    const runId = ((await call('POST', `/api/v1/rooms/${aliceRoom}/start`, alice, { topic: 'A 的议题' })).json() as { id: string }).id;

    expect((await call('GET', `/api/v1/rooms/${bobRoom}/runs/${runId}`, bob)).statusCode).toBe(404);
  });
});

describe('治理动作与撤销', () => {
  it('移出前必须已有警告或禁言记录', async () => {
    const owner = await register('kick-owner');
    const roomId = await createRoom(owner);
    const roleId = await addRole(owner, roomId, '将被移出');

    const kick = await call('POST', `/api/v1/rooms/${roomId}/moderation`, owner, {
      action: 'kick',
      reason: '直接移出',
      targetRoleId: roleId,
    });
    expect(kick.statusCode).toBe(409);
    expect(kick.json()).toMatchObject({ error: 'kick_requires_prior_warning' });

    const warn = await call('POST', `/api/v1/rooms/${roomId}/moderation`, owner, {
      action: 'warn',
      reason: '先警告',
      targetRoleId: roleId,
    });
    expect(warn.statusCode).toBe(201);

    const kickNow = await call('POST', `/api/v1/rooms/${roomId}/moderation`, owner, {
      action: 'kick',
      reason: '警告无效后移出',
      targetRoleId: roleId,
    });
    expect(kickNow.statusCode).toBe(201);
    const role = await prisma.roomRole.findFirst({ where: { id: roleId } });
    expect(role).not.toBeNull();
  });

  it('禁言必须带到期轮次；撤销保留原动作并记录撤销人', async () => {
    const owner = await register('mute-owner');
    const roomId = await createRoom(owner);
    const roleId = await addRole(owner, roomId, '将被禁言');
    await addRole(owner, roomId, '乙');
    const runId = ((await call('POST', `/api/v1/rooms/${roomId}/start`, owner, { topic: '禁言测试' })).json() as { id: string }).id;

    const mute = await call('POST', `/api/v1/rooms/${roomId}/moderation`, owner, {
      action: 'mute',
      reason: '连续偏题',
      targetRoleId: roleId,
    });
    expect(mute.statusCode).toBe(201);
    expect((mute.json() as { mutedUntilRound: number }).mutedUntilRound).toBeGreaterThan(0);

    const state = await prisma.runAgentState.findUnique({ where: { runId_roleId: { runId, roleId } } });
    expect(state?.state).toBe('muted');
    expect(state?.mutedUntilRound).toBeGreaterThan(0);

    const eventId = (mute.json() as { event: { id: string } }).event.id;
    const revoked = await call('POST', `/api/v1/rooms/${roomId}/events/${eventId}/revoke`, owner, {});
    expect(revoked.statusCode).toBe(200);

    const stored = await prisma.moderationEvent.findUnique({ where: { id: eventId } });
    // 撤销不能改写"当初做了什么处置"
    expect(stored?.action).toBe('mute');
    expect(stored?.revertedAt).not.toBeNull();
    expect(stored?.revertedBy).toBe(owner.id);

    const afterRevoke = await prisma.runAgentState.findUnique({ where: { runId_roleId: { runId, roleId } } });
    expect(afterRevoke?.state).toBe('idle');

    expect(
      (await call('POST', `/api/v1/rooms/${roomId}/events/${eventId}/revoke`, owner, {})).statusCode,
    ).toBe(409);
  });

  it('证据消息必须来自本房间，不能拿别人的消息当依据', async () => {
    const owner = await register('evid-owner');
    const other = await register('evid-other');
    const roomA = await createRoom(owner);
    const roomB = await createRoom(other);
    const roleId = await addRole(owner, roomA, '甲');
    const foreignMessage = await call('POST', `/api/v1/rooms/${roomB}/messages`, other, { content: '别的房间的消息' });
    const foreignId = (foreignMessage.json() as { id: string }).id;

    const response = await call('POST', `/api/v1/rooms/${roomA}/moderation`, owner, {
      action: 'warn',
      reason: '越房引用',
      targetRoleId: roleId,
      evidenceMessageId: foreignId,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'evidence_not_in_room' });
  });

  it('非房主不能执行治理动作', async () => {
    const owner = await register('mod-owner');
    const member = await register('mod-member');
    const roomId = await createRoom(owner);
    const roleId = await addRole(owner, roomId, '甲');
    const join = await call('POST', `/api/v1/rooms/${roomId}/join`, member, {});
    await call('POST', `/api/v1/rooms/${roomId}/memberships/${(join.json() as { id: string }).id}/approve`, owner, {});

    const response = await call('POST', `/api/v1/rooms/${roomId}/moderation`, member, {
      action: 'warn',
      reason: '成员越权治理',
      targetRoleId: roleId,
    });
    expect(response.statusCode).toBe(403);
  });
});

const VALID_POLICY = {
  rules: [
    { id: 'R-01', kind: 'off_topic', label: '偏离主题', action: 'remind', threshold: 0.6 },
    { id: 'R-05', kind: 'forbidden_topic', label: '禁区话题', action: 'kick', safety: true, keywords: ['内幕交易'] },
  ],
  ladder: ['remind', 'warn', 'mute', 'kick'],
};

describe('策略版本化', () => {
  it('发布产生新版本，旧版本保持不可变', async () => {
    const owner = await register('policy-owner');
    const roomId = await createRoom(owner);

    const first = await call('POST', `/api/v1/rooms/${roomId}/policy`, owner, VALID_POLICY);
    expect(first.statusCode).toBe(201);
    const firstBody = first.json() as { id: string; version: number; rules: unknown[] };
    expect(firstBody.version).toBe(1);

    // 改一下再发：必须是新版本，而不是原地覆盖
    const edited = { ...VALID_POLICY, ladder: ['remind', 'warn'] } as const;
    const second = await call('POST', `/api/v1/rooms/${roomId}/policy`, owner, edited);
    expect(second.statusCode).toBe(201);
    expect((second.json() as { version: number }).version).toBe(2);

    const stored = await prisma.moderatorPolicy.findUnique({ where: { id: firstBody.id } });
    expect((stored!.ladder as unknown[]).length).toBe(4);

    const current = await call('GET', `/api/v1/rooms/${roomId}/policy`, owner);
    expect(current.statusCode).toBe(200);
    expect((current.json() as { version: number }).version).toBe(2);

    const history = await call('GET', `/api/v1/rooms/${roomId}/policies`, owner);
    const versions = (history.json() as { version: number }[]).map((entry) => entry.version);
    expect(versions).toEqual([2, 1]);
  });

  it('语义校验不过时拒绝发布，并列出全部冲突项', async () => {
    const owner = await register('policy-invalid-owner');
    const roomId = await createRoom(owner);

    const response = await call('POST', `/api/v1/rooms/${roomId}/policy`, owner, {
      rules: [{ id: 'R-01', kind: 'off_topic', label: '缺阈值', action: 'remind' }],
      ladder: ['kick', 'warn'],
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: string; issues: { path: string }[] };
    expect(body.error).toBe('policy_invalid');
    expect(body.issues.map((issue) => issue.path)).toEqual(['rules[0].threshold', 'ladder[1]']);
    // 拒绝发布不能留下半个版本
    expect(await prisma.moderatorPolicy.count({ where: { roomId } })).toBe(0);
  });

  it('读策略的权限边界：成员可读、匿名与非成员不可', async () => {
    const owner = await register('policy-read-owner');
    const stranger = await register('policy-read-stranger');
    const roomId = await createRoom(owner, { visibility: 'public' });
    await call('POST', `/api/v1/rooms/${roomId}/policy`, owner, VALID_POLICY);

    expect((await call('GET', `/api/v1/rooms/${roomId}/policy`)).statusCode).toBe(401);
    expect((await call('GET', `/api/v1/rooms/${roomId}/policy`, stranger)).statusCode).toBe(403);
    expect((await call('GET', `/api/v1/rooms/${roomId}/policy`, owner)).statusCode).toBe(200);
    // 版本列表只对房主开放
    expect((await call('GET', `/api/v1/rooms/${roomId}/policies`, stranger)).statusCode).toBe(403);
  });
});

describe('讨论复盘端点', () => {
  it('尚未生成时返回 pending 而不是 404', async () => {
    const owner = await register('summary-owner');
    const roomId = await createRoom(owner);
    await addRole(owner, roomId, '甲');
    const runId = ((await call('POST', `/api/v1/rooms/${roomId}/start`, owner, { topic: '复盘测试议题' })).json() as { id: string }).id;

    const response = await call('GET', `/api/v1/rooms/${roomId}/runs/${runId}/summary`, owner);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'pending', payload: null });
  });

  it('返回已生成的摘要，且每条结论都能定位到真实消息（验收 #7）', async () => {
    const owner = await register('summary-done-owner');
    const roomId = await createRoom(owner);
    await addRole(owner, roomId, '甲');
    const started = (await call('POST', `/api/v1/rooms/${roomId}/start`, owner, { topic: '复盘测试议题' })).json() as { id: string };
    const message = await appendRoomMessage(prisma, {
      roomId,
      runId: started.id,
      senderType: 'agent',
      content: '先定义衡量口径，再比较方案。',
      status: 'completed',
    });

    await prisma.discussionSummary.create({
      data: {
        runId: started.id,
        status: 'ready',
        payload: {
          mode: 'extractive',
          keyPoints: [{ text: '先定义衡量口径', sourceMessageIds: [message.id] }],
          camps: [],
          disputes: [],
          consensus: [],
          unresolved: [],
          moderation: [],
          followUps: [],
        } as Prisma.InputJsonValue,
        sourceMessageIds: [message.id] as Prisma.InputJsonValue,
      },
    });

    const response = await call('GET', `/api/v1/rooms/${roomId}/runs/${started.id}/summary`, owner);
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; payload: { keyPoints: { text: string; sourceMessageIds: string[] }[] } };
    expect(body.status).toBe('ready');
    expect(body.payload.keyPoints[0]!.sourceMessageIds).toEqual([message.id]);
    // 引用必须指向真实存在的消息，否则界面点不出原文
    expect(await prisma.message.count({ where: { id: message.id } })).toBe(1);
  });

  it('重新生成只对房主开放，并真的排入 summarize 任务', async () => {
    const owner = await register('summary-regen-owner');
    const member = await register('summary-regen-member');
    const roomId = await createRoom(owner);
    const join = await call('POST', `/api/v1/rooms/${roomId}/join`, member, {});
    await call('POST', `/api/v1/rooms/${roomId}/memberships/${(join.json() as { id: string }).id}/approve`, owner, {});

    expect(
      (await call('POST', `/api/v1/rooms/${roomId}/runs/${randomUUID()}/summary`, owner)).statusCode,
    ).toBe(404);
    expect(
      (await call('POST', `/api/v1/rooms/${roomId}/runs/${randomUUID()}/summary`, member)).statusCode,
    ).toBe(403);
  });
});
