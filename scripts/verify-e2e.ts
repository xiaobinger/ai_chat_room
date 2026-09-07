/**
 * 闸门 2 的端到端验收：以真实进程拓扑跑一遍产品主链路。
 *
 *   终端 1:  pnpm dev:api
 *   终端 2:  pnpm dev:worker
 *   终端 3:  pnpm verify:e2e
 *
 * 逐条覆盖 mvp-spec §9 的 7 条验收条件：
 * #1 多角色自主多轮发言、#2 偏题产生治理事件、#3 房主控制即时反馈、
 * #4 暂停后 2 秒内无新 AI 消息、#5 撤销进入审计、
 * #6 刷新不丢不重、#7 复盘可定位到原消息。
 *
 * 刻意走 HTTP + 真 WS + 跨进程队列，而不是直接调内部函数：
 * 本项目最初的故障正是"每一层单看都对，层与层之间根本没接上"。
 */
import { WebSocket } from 'ws';
import { RUN_QUEUE_NAME, type WSEvent } from '@tianma/contracts';
import { loadEnv } from '@tianma/database/load-env';
import { prisma } from '@tianma/database';

loadEnv();

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4000';
const MODEL = process.env.E2E_MODEL ?? 'mock';
const ROUNDS = Number(process.env.E2E_ROUNDS ?? 3);

interface Session {
  token: string;
  userId: string;
}

async function api(method: string, url: string, session?: Session, body?: unknown): Promise<unknown> {
  const response = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      // 无体的请求不能声称自己是 JSON，否则 Fastify 会以"空 JSON 体"直接拒绝
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(session ? { authorization: `Bearer ${session.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    throw new Error(`${method} ${url} -> ${response.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

/**
 * 把 Run 收敛到终态。
 *
 * 服务端用乐观并发拒绝"覆盖自己没读过的状态"（§1.4），所以客户端必须能处理
 * 409 concurrent_update：重读、按当前状态挑合法命令、有限重试。
 */
async function settleRun(roomId: string, runId: string, session: Session): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const run = (await api('GET', `/api/v1/rooms/${roomId}/runs/${runId}`, session)) as {
      status: string;
    };
    if (run.status === 'terminated' || run.status === 'completed') return;

    const command = run.status === 'queued' ? 'cancel' : 'terminate';
    try {
      await api('POST', `/api/v1/rooms/${roomId}/runs/${runId}/commands`, session, {
        command,
        terminationReason: 'owner_terminated',
      });
    } catch {
      // 409 说明状态在读写之间又动了，下一轮重读即可
      await new Promise((done) => setTimeout(done, 250));
    }
  }
}

function check(label: string, passed: boolean, evidence = ''): boolean {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${evidence ? ` — ${evidence}` : ''}`);
  return passed;
}

async function main(): Promise<number> {
  console.log(`目标 ${BASE}  模型=${MODEL}  队列=${RUN_QUEUE_NAME}\n`);

  const email = `e2e.${Date.now().toString(36)}@e2e.test`;
  const registered = (await api('POST', '/api/v1/auth/register', undefined, {
    email,
    password: 'e2e-password-123',
    displayName: 'E2E Owner',
  })) as { token: string; user: { id: string } };
  const session: Session = { token: registered.token, userId: registered.user.id };

  const room = (await api('POST', '/api/v1/rooms', session, {
    title: 'E2E 远程办公是不是伪命题',
    mode: 'structured',
    visibility: 'public',
  })) as { id: string };

  for (const [name, stance] of [
    ['正方', '远程办公是效率净收益'],
    ['反方', '协作损耗被系统性低估'],
    ['主持人', ''],
  ] as const) {
    await api('POST', `/api/v1/rooms/${room.id}/roles`, session, {
      name,
      type: name === '主持人' ? 'host' : 'debater',
      systemPrompt:
        name === '主持人'
          ? '归纳共识、点明分歧、提出下一个问题，不表达立场。'
          : '你是圆桌讨论的参与者，用一段不超过 120 字的话回应上一条观点。',
      stance,
      modelName: MODEL,
    });
  }

  const socket = new WebSocket(
    `${BASE.replace('http', 'ws')}/api/v1/rooms/${room.id}/ws?token=${encodeURIComponent(session.token)}`,
  );
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
    setTimeout(() => reject(new Error('WS 握手超时')), 8000);
  });

  const collected: WSEvent[] = [];
  socket.on('message', (raw: Buffer) => collected.push(JSON.parse(String(raw)) as WSEvent));

  const started = (await api('POST', `/api/v1/rooms/${room.id}/start`, session, {
    topic: '远程办公是不是伪命题',
    goal: '产出可执行结论',
    settings: { maxRounds: ROUNDS, maxConsecutiveTurns: 10 },
  })) as { id: string; status: string };
  console.log(`run=${started.id} status=${started.status}\n`);

  // 等到终态，最多 60 秒
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const status = (await api('GET', `/api/v1/rooms/${room.id}/runs/${started.id}`, session)) as {
      status: string;
    };
    if (status.status === 'terminated' || status.status === 'completed') break;
    await new Promise((done) => setTimeout(done, 500));
  }

  const final = (await api('GET', `/api/v1/rooms/${room.id}/runs/${started.id}`, session)) as {
    status: string;
    currentRound: number;
    terminationReason: string | null;
    messages: Array<{ sequence: number; senderType: string; content: string; roleId: string | null }>;
  };

  const agentMessages = final.messages.filter((message) => message.senderType === 'agent');
  const sequences = final.messages.map((message) => message.sequence);
  const contiguous = sequences.every((value, index) => value === index + 1);
  const distinctSpeakers = new Set(agentMessages.map((message) => message.roleId)).size;
  const pushedMessages = collected.filter((event) => event.type === 'message').length;
  const sawTerminal = collected.some(
    (event) => event.type === 'run_status' && (event.payload as { status: string }).status !== 'running',
  );

  let ok = true;
  ok =
    check(
      '#1 多个角色围绕主题自主发言',
      agentMessages.length >= ROUNDS && distinctSpeakers >= 2,
      `${agentMessages.length} 条 AI 发言 / ${distinctSpeakers} 个角色 / ${final.currentRound} 轮`,
    ) && ok;
  ok =
    check('#1 讨论以正常原因收场', ['round_limit', 'completed', 'token_budget'].includes(final.terminationReason ?? ''), `status=${final.status} reason=${final.terminationReason}`) &&
    ok;
  ok =
    check(
      '#6 跨进程事件真的推到了 WS 连接',
      pushedMessages >= agentMessages.length,
      `WS 收到 ${pushedMessages} 条 message，库里 ${agentMessages.length} 条 AI 发言`,
    ) && ok;
  ok = check('#6 序号从 1 连续无缺口', contiguous, `seq=[${sequences.join(',')}]`) && ok;
  ok = check('#6 终态事件也推到了 WS', sawTerminal) && ok;

  // 刷新等价路径：重新拉一次必须拿到同一批消息，不重复也不缺
  const refetch = (await api(
    'GET',
    `/api/v1/rooms/${room.id}/messages?after=0`,
    session,
  )) as Array<{ id: string }>;
  ok =
    check(
      '#6 重连回补与终态一致（不丢不重）',
      refetch.length === final.messages.length &&
        new Set(refetch.map((message) => message.id)).size === refetch.length,
      `回补 ${refetch.length} / 终态 ${final.messages.length}`,
    ) && ok;

  // ---- 验收 #4：暂停后 2 秒内无新 AI 消息 ----
  const second = (await api('POST', `/api/v1/rooms/${room.id}/start`, session, {
    topic: '远程办公是不是伪命题（第二次）',
    settings: { maxRounds: 50, maxConsecutiveTurns: 10 },
  })) as { id: string };

  let paused = false;
  const pauseDeadline = Date.now() + 45_000;
  while (!paused && Date.now() < pauseDeadline) {
    const before = (await api('GET', `/api/v1/rooms/${room.id}/runs/${second.id}`, session)) as {
      messages: unknown[];
    };
    if (before.messages.filter((m) => (m as { senderType: string }).senderType === 'agent').length >= 1) {
      await api('POST', `/api/v1/rooms/${room.id}/runs/${second.id}/commands`, session, { command: 'pause' });
      paused = true;
    } else {
      await new Promise((done) => setTimeout(done, 300));
    }
  }
  if (!paused) {
    ok = check('#4 能在发言后成功暂停', false, '等待首条发言超时') && ok;
  } else {
    const atPause = (await api('GET', `/api/v1/rooms/${room.id}/runs/${second.id}`, session)) as {
      status: string;
      messages: Array<{ senderType: string }>;
    };
    const countAtPause = atPause.messages.filter((m) => m.senderType === 'agent').length;
    await new Promise((done) => setTimeout(done, 2500));
    const afterPause = (await api('GET', `/api/v1/rooms/${room.id}/runs/${second.id}`, session)) as {
      messages: Array<{ senderType: string }>;
    };
    const countAfter = afterPause.messages.filter((m) => m.senderType === 'agent').length;
    ok =
      check(
        '#4 暂停后 2 秒内无新 AI 消息',
        atPause.status === 'paused' && countAfter === countAtPause,
        `暂停时 ${countAtPause} 条，2.5 秒后 ${countAfter} 条`,
      ) && ok;

    // 恢复后轮次必须继续递增
    await api('POST', `/api/v1/rooms/${room.id}/runs/${second.id}/commands`, session, { command: 'resume' });
    await new Promise((done) => setTimeout(done, 1500));
    const resumed = (await api('GET', `/api/v1/rooms/${room.id}/runs/${second.id}`, session)) as {
      status: string;
    };
    ok =
      check('#3 恢复后重新排队并继续', ['queued', 'running'].includes(resumed.status), `status=${resumed.status}`) &&
      ok;
    // queued 上没有 TERMINATE、running 上没有 CANCEL。读到写之间 Worker 可能已经认领，
    // 服务端会以 409 concurrent_update 拒绝覆盖它没读过的状态（§1.4 正确行为），
    // 所以客户端必须重读重选命令再试 —— 这里就是在演练真实前端该做的事。
    await settleRun(room.id, second.id, session);
  }

  // ---- 闸门 3：AI 管理员、撤销审计、可追溯复盘 ----
  // 用只含 1 个角色的独立房间：mock 的确定性"病症"按发言序号触发，
  // 单角色最容易在有限轮次内把 提醒 → 警告 → 禁言 的阶梯走完。
  const govRoom = (await api('POST', '/api/v1/rooms', session, {
    title: '治理与复盘专用房间',
    mode: 'free',
    moderatorEnabled: true,
  })) as { id: string };
  await api('POST', `/api/v1/rooms/${govRoom.id}/roles`, session, {
    name: '讲者',
    type: 'debater',
    systemPrompt: '你就本场议题发言，一句话即可。',
    modelName: MODEL,
  });
  await api('POST', `/api/v1/rooms/${govRoom.id}/policy`, session, {
    rules: [
      {
        id: 'R-05',
        kind: 'forbidden_topic',
        label: '禁区话题',
        action: 'kick',
        safety: true,
        keywords: ['内幕交易'],
      },
    ],
    ladder: ['remind', 'warn', 'mute', 'kick'],
  });

  const govRun = (await api('POST', `/api/v1/rooms/${govRoom.id}/start`, session, {
    topic: '治理能否自动触发',
    settings: { maxRounds: 18, maxConsecutiveTurns: 10 },
  })) as { id: string };

  const govDeadline = Date.now() + 60_000;
  for (;;) {
    const state = (await api('GET', `/api/v1/rooms/${govRoom.id}/runs/${govRun.id}`, session)) as {
      status: string;
    };
    if (state.status === 'terminated' || state.status === 'completed') break;
    if (Date.now() > govDeadline) break;
    await new Promise((done) => setTimeout(done, 400));
  }

  type GovEvent = {
    id: string;
    action: string;
    actorType: string;
    matchedRule: string | null;
    policyVersion: number | null;
    reason: string;
    durationRounds: number | null;
    evidenceMessageIds: unknown;
    revertedAt: string | null;
  };
  const events = (await api('GET', `/api/v1/rooms/${govRoom.id}/events`, session)) as GovEvent[];

  ok =
    check(
      '#2 AI 管理员自动产出含规则/证据/说明/动作/版本的治理事件',
      events.length > 0 &&
        events.every(
          (event) =>
            event.actorType === 'moderator' &&
            event.matchedRule === 'R-05' &&
            event.policyVersion === 1 &&
            Array.isArray(event.evidenceMessageIds) &&
            event.evidenceMessageIds.length > 0 &&
            event.reason.length > 0,
        ),
      `${events.length} 条：${events.map((event) => event.action).join(' → ')}`,
    ) && ok;

  // /events 是"最新在前"的信息流顺序，断言阶梯要先还原成时间序
  const chronological = [...events].reverse();
  ok =
    check(
      '#2 阶梯随重复违规逐级升档',
      JSON.stringify(chronological.map((event) => event.action)) ===
        JSON.stringify(['remind', 'warn', 'mute', 'kick']),
      `时间序 ${chronological.map((event) => event.action).join(' → ')}`,
    ) && ok;

  const muteEvent = events.find((event) => event.action === 'mute');
  ok =
    check(
      '#4 禁言带到期轮次，不是纸面动作',
      Boolean(muteEvent && (muteEvent.durationRounds ?? 0) > 0),
      muteEvent ? `时长 ${muteEvent.durationRounds} 轮` : '未走到禁言档',
    ) && ok;

  // ---- 验收 #5：房主撤销 ----
  if (muteEvent) {
    const revoked = (await api('POST', `/api/v1/rooms/${govRoom.id}/events/${muteEvent.id}/revoke`, session)) as {
      event?: { id: string };
    };
    ok = check('#5 房主可撤销禁言', Boolean(revoked.event), JSON.stringify(revoked).slice(0, 120)) && ok;

    const after = (await api('GET', `/api/v1/rooms/${govRoom.id}/events`, session)) as GovEvent[];
    const same = after.find((event) => event.id === muteEvent.id);
    ok =
      check(
        '#5 撤销写入撤销人与时间，且原处置动作未被改写',
        Boolean(same?.revertedAt) && same?.action === 'mute',
        `revertedAt=${same?.revertedAt ?? 'null'} action=${same?.action ?? 'null'}`,
      ) && ok;
  }

  // ---- 验收 #7：复盘可追溯 ----
  const summary = (await api('GET', `/api/v1/rooms/${govRoom.id}/runs/${govRun.id}/summary`, session)) as {
    status: string;
    error: string | null;
    payload: {
      mode: string;
      keyPoints: Array<{ text: string; sourceMessageIds: string[] }>;
      moderation: Array<{ text: string; sourceMessageIds: string[] }>;
    } | null;
  };

  ok =
    check(
      '#7 终态后复盘自动生成',
      summary.status === 'ready' && summary.payload !== null,
      `status=${summary.status} mode=${summary.payload?.mode ?? '-'}${summary.error ? ` 原因：${summary.error}` : ''}`,
    ) && ok;

  const cited = [
    ...(summary.payload?.keyPoints ?? []),
    ...(summary.payload?.moderation ?? []),
  ].flatMap((item) => item.sourceMessageIds);
  // 只用已有端点核验引用是否真的存在，不为此臆造统计接口
  const allMessages = (await api('GET', `/api/v1/rooms/${govRoom.id}/messages?after=0&limit=200`, session)) as Array<{
    id: string;
  }>;
  const known = new Set(allMessages.map((message) => message.id));
  const dangling = [...new Set(cited)].filter((id) => !known.has(id));
  ok =
    check(
      '#7 复盘的每条引用都能定位到真实消息',
      cited.length > 0 && dangling.length === 0,
      `引用 ${new Set(cited).size} 处，指向不明的 ${dangling.length} 处`,
    ) && ok;

  ok =
    check(
      '#7 治理段落由确定性数据构成，条数与事件一致',
      (summary.payload?.moderation.length ?? 0) === events.length,
      `复盘 ${summary.payload?.moderation.length ?? 0} 条 / 事件 ${events.length} 条`,
    ) && ok;

  socket.close();

  // 黑盒测试用真库跑，收尾必须自己清干净，否则每次验证都在共享实例里留一份垃圾
  try {
    await prisma.room.delete({ where: { id: govRoom.id } });
    await prisma.room.delete({ where: { id: room.id } });
    await prisma.user.delete({ where: { id: session.userId } });
  } catch (error) {
    console.log(`（清理测试数据失败，可手动删除 room=${room.id} user=${session.userId}：${(error as Error).message}）`);
  } finally {
    await prisma.$disconnect();
  }

  console.log(ok ? '\n端到端验收通过：mvp-spec §9 全部 7 条' : '\n端到端验收未通过');
  return ok ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  },
);
