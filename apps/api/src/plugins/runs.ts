import { FastifyPluginAsync } from 'fastify';
import { prisma } from '@tianma/database';
import { runTransition, type RunEvent } from '@tianma/ai-core';
import {
  DEFAULT_RUN_SETTINGS,
  DiscussionRunSchema,
  MessageSchema,
  RunCommandSchema,
  type RunTerminationReason,
} from '@tianma/contracts';
import { roomAccess } from '../auth/guards';
import { roomGateway } from '../ws/room-gateway';
import { runQueue } from '../queue';

/** 控制动作以事件表达，客户端不能直接指定目标状态（contracts RunCommandSchema）。 */
const COMMAND_EVENT = {
  pause: 'PAUSE',
  resume: 'RESUME',
  complete: 'COMPLETE',
  terminate: 'TERMINATE',
  cancel: 'CANCEL',
  retry: 'RETRY',
} as const satisfies Record<string, RunEvent>;

/** 这些事件之后 Run 不再推进，必须同时收回 Worker 的调度租约。 */
const LEASE_REVOKING: ReadonlySet<RunEvent> = new Set(['PAUSE', 'CANCEL', 'TERMINATE', 'COMPLETE']);
const REENQUEUE: ReadonlySet<RunEvent> = new Set(['RESUME', 'RETRY']);

const RUN_FIELDS = {
  id: true,
  roomId: true,
  topic: true,
  goal: true,
  completionCriteria: true,
  status: true,
  currentRound: true,
  settings: true,
  terminationReason: true,
  version: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
  createdBy: true,
} as const;

export const runsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/rooms/:roomId/runs', async (request) => {
    const { roomId } = request.params as { roomId: string };
    await roomAccess(request, roomId, 'member');
    const runs = await prisma.discussionRun.findMany({
      where: { roomId },
      // 按随机 UUID 排序等于没有排序
      orderBy: { createdAt: 'desc' },
      select: {
        ...RUN_FIELDS,
        _count: { select: { messages: true, moderationEvents: true, scheduleAudits: true } },
        creator: { select: { id: true, displayName: true } },
      },
    });
    return runs;
  });

  /** 复盘与断线回补的主查询。必须校验 run 确实属于这个房间，否则是跨房读取。 */
  fastify.get('/rooms/:roomId/runs/:runId', async (request, reply) => {
    const { roomId, runId } = request.params as { roomId: string; runId: string };
    await roomAccess(request, roomId, 'member');

    const run = await prisma.discussionRun.findFirst({
      where: { id: runId, roomId },
      select: {
        ...RUN_FIELDS,
        agentStates: true,
        moderationEvents: { orderBy: { createdAt: 'asc' } },
        scheduleAudits: { orderBy: { round: 'asc' }, take: 200 },
        summary: true,
        creator: { select: { id: true, displayName: true } },
      },
    });
    if (!run) return reply.status(404).send({ error: 'run_not_found' });

    const messages = await prisma.message.findMany({
      where: { runId },
      orderBy: { sequence: 'asc' },
      include: { role: { select: { id: true, name: true, color: true } } },
    });

    // DiscussionRunSchema 只覆盖 run 自身的列，关联字段必须拆出来单独返回，
    // 否则会被 zod 的 object 静默剥掉（前端读 run.agentStates 就是 undefined）
    const { agentStates, moderationEvents, scheduleAudits, summary, creator, ...columns } = run;
    return {
      ...DiscussionRunSchema.parse(columns),
      creator,
      agentStates,
      moderationEvents,
      scheduleAudits,
      summary,
      // 契约的 Message 不含 role；这里在校验之后再附加
      messages: messages.map((message) => ({
        ...MessageSchema.parse(message),
        role: message.role ?? null,
      })),
    };
  });

  /**
   * 重启讨论：在同一房间创建新 Run，复制旧 Run 的配置（topic/goal/settings），
   * 轮次归零、token 预算重置。旧 Run 保持终态不变（可追溯）。
   * 房间角色无需复制——它们属于房间而非 Run。
   */
  fastify.post('/rooms/:roomId/runs/:runId/restart', async (request, reply) => {
    const { roomId, runId } = request.params as { roomId: string; runId: string };
    const access = await roomAccess(request, roomId, 'owner');

    const previous = await prisma.discussionRun.findFirst({
      where: { id: runId, roomId },
      select: { topic: true, goal: true, completionCriteria: true, settings: true },
    });
    if (!previous) return reply.status(404).send({ error: 'run_not_found' });

    const speakable = await prisma.roomRole.count({ where: { roomId } });
    if (speakable === 0) return reply.status(400).send({ error: 'no_speakable_agent' });

    const run = await prisma.discussionRun.create({
      data: {
        roomId,
        topic: previous.topic,
        goal: previous.goal,
        completionCriteria: previous.completionCriteria,
        status: 'queued',
        settings: previous.settings ?? { ...DEFAULT_RUN_SETTINGS },
        createdBy: access.user.id,
      },
    });

    await prisma.room.update({ where: { id: roomId }, data: { status: 'running' } });
    await runQueue.add('run', { runId: run.id, action: 'run' }, { jobId: `run:${run.id}:restart` });

    return reply.status(201).send(run);
  });

  fastify.post('/rooms/:roomId/runs/:runId/commands', async (request, reply) => {
    const { roomId, runId } = request.params as { roomId: string; runId: string };
    const access = await roomAccess(request, roomId, 'owner');
    if (!access.isOwner && !access.room.membersCanStartRun) {
      return reply.status(403).send({ error: 'members_cannot_start' });
    }
    const parsed = RunCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }

    const run = await prisma.discussionRun.findFirst({
      where: { id: runId, roomId },
      select: { status: true, version: true },
    });
    if (!run) return reply.status(404).send({ error: 'run_not_found' });

    const event = COMMAND_EVENT[parsed.data.command];
    const transition = runTransition(run.status, event);
    if (!transition.ok) {
      // §2.3 非法转移不得静默成功：返回冲突让客户端重新同步状态
      return reply.status(409).send({ error: transition.reason, from: run.status, event });
    }

    const terminating = transition.to === 'completed' || transition.to === 'terminated';
    const reason: RunTerminationReason | undefined =
      event === 'CANCEL'
        ? 'user_cancelled'
        : event === 'TERMINATE'
          ? (parsed.data.terminationReason ?? 'owner_terminated')
          : undefined;

    // where 带 status + version：与 Worker 的乐观提交同一套语义，
    // 并发下只会有一方成功，失败方拿到 409 后重新读取
    const applied = await prisma.discussionRun.updateMany({
      where: { id: runId, status: run.status, version: run.version },
      data: {
        status: transition.to,
        version: { increment: 1 },
        ...(LEASE_REVOKING.has(event) ? { leaseToken: null, leaseExpiresAt: null } : {}),
        ...(terminating
          ? { endedAt: new Date(), ...(reason ? { terminationReason: reason } : {}) }
          : {}),
        ...(event === 'RESUME' || event === 'RETRY' ? { terminationReason: null, endedAt: null } : {}),
      },
    });
    if (applied.count !== 1) {
      return reply.status(409).send({ error: 'concurrent_update', from: run.status, event });
    }

    const roomStatus =
      transition.to === 'running'
        ? 'running'
        : transition.to === 'paused'
          ? 'paused'
          : terminating
            ? 'idle'
            : undefined;
    if (roomStatus) {
      await prisma.room.update({ where: { id: roomId }, data: { status: roomStatus } });
    }

    // BullMQ 按 jobId 去重。若恢复任务沿用首次启动的 id，而那个任务还留在
    // completed 保留窗口里，BullMQ 会把它当重复直接丢弃 —— 表现为"恢复"按了没反应、
    // Run 永远停在 paused。绑到本次动作递增出的 version 上：
    // 同一版本的重复点击仍然去重，真正的恢复则必然排入一个新任务。
    const nextVersion = run.version + 1;
    if (REENQUEUE.has(event)) {
      await runQueue.add('run', { runId, action: 'run' }, { jobId: `run:${runId}:v${nextVersion}` });
    }
    // 房主正常结束后 Run 不再推进，Worker 不会自然走到终态分支，
    // 所以复盘必须作为第二种任务派过去 —— 模型能力只在 Worker 侧。
    if (transition.to === 'completed') {
      await runQueue.add(
        'summarize',
        { runId, action: 'summarize' },
        { jobId: `summarize:${runId}:v${nextVersion}` },
      );
    }

    const updated = await prisma.discussionRun.findUniqueOrThrow({
      where: { id: runId },
      select: RUN_FIELDS,
    });
    roomGateway.broadcast(roomId, {
      type: 'run_status',
      payload: {
        runId,
        status: updated.status,
        currentRound: updated.currentRound,
        terminationReason: updated.terminationReason,
        endedAt: updated.endedAt,
      },
    });

    return updated;
  });

  /**
   * 复盘摘要。成员可读（复盘页要能打开）；尚未生成时返回 pending 而不是 404，
   * 让界面能显示"生成中"而不是报错。
   */
  fastify.get('/rooms/:roomId/runs/:runId/summary', async (request, reply) => {
    const { roomId, runId } = request.params as { roomId: string; runId: string };
    await roomAccess(request, roomId, 'member');

    const run = await prisma.discussionRun.findFirst({
      where: { id: runId, roomId },
      select: { id: true, summary: true },
    });
    if (!run) return reply.status(404).send({ error: 'run_not_found' });
    if (!run.summary) return { status: 'pending', payload: null };

    return {
      status: run.summary.status,
      error: run.summary.error,
      createdAt: run.summary.createdAt,
      updatedAt: run.summary.updatedAt,
      sourceMessageIds: run.summary.sourceMessageIds,
      payload: run.summary.payload,
    };
  });

  /** 重新生成：模型侧偶发不可用时，房主可以点一下重派归纳任务。 */
  fastify.post('/rooms/:roomId/runs/:runId/summary', async (request, reply) => {
    const { roomId, runId } = request.params as { roomId: string; runId: string };
    await roomAccess(request, roomId, 'owner');

    const run = await prisma.discussionRun.findFirst({
      where: { id: runId, roomId },
      select: { id: true, status: true, version: true },
    });
    if (!run) return reply.status(404).send({ error: 'run_not_found' });

    await runQueue.add('summarize', { runId, action: 'summarize' }, {
      jobId: `summarize:${runId}:manual:${Date.now()}`,
    });
    return reply.status(202).send({ queued: true });
  });
};
