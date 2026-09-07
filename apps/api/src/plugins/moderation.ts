import { FastifyPluginAsync } from 'fastify';
import { appendRoomMessage, prisma } from '@tianma/database';
import { roleTransition } from '@tianma/ai-core';
import {
  ModerationActionInputSchema,
  ModerationEventSchema,
  type ModerationAction,
} from '@tianma/contracts';
import { Conflict, roomAccess } from '../auth/guards';
import { roomGateway } from '../ws/room-gateway';
import { messagePayload } from '../lib/events';

const ACTION_LABELS: Record<ModerationAction, string> = {
  remind: '提醒',
  warn: '警告',
  mute: '限时禁言',
  kick: '移出',
  revoke: '撤销',
};

/** 处罚阶梯游标：0 无 → 1 提醒 → 2 警告 → 3 限时禁言 → 4 移出 */
const ACTION_LEVEL: Record<ModerationAction, number> = {
  remind: 1,
  warn: 2,
  mute: 3,
  kick: 4,
  revoke: 0,
};

/** 这个房间当前仍在推进的 Run（暂停也算，恢复后继续）。 */
async function activeRunId(roomId: string): Promise<string | null> {
  const run = await prisma.discussionRun.findFirst({
    where: { roomId, status: { in: ['queued', 'running', 'paused', 'failed'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, currentRound: true, settings: true },
  });
  return run ? run.id : null;
}

async function currentRoundOf(runId: string | null): Promise<number> {
  if (!runId) return 0;
  const run = await prisma.discussionRun.findUnique({ where: { id: runId }, select: { currentRound: true } });
  return run?.currentRound ?? 0;
}

/**
 * 执行治理动作对角色运行态的影响。
 *
 * permissions §4 的三条硬约束在这里落地：
 * - 禁言必须带到期轮次，永久禁言不进 MVP；
 * - 移出前必须已有警告或禁言记录（安全紧急规则由 AI 管理员侧另行豁免）；
 * - 撤销禁言走 UNMUTE 回 idle；撤销移出只留撤销标记，恢复发言必须重新添加角色。
 */
async function applyRoleEffect(
  roomId: string,
  roleId: string,
  action: ModerationAction,
  durationRounds: number,
): Promise<{ state: string; mutedUntilRound: number }> {
  const runId = await activeRunId(roomId);
  if (!runId) return { state: 'idle', mutedUntilRound: 0 };

  const existing = await prisma.runAgentState.findUnique({
    where: { runId_roleId: { runId, roleId } },
    select: { state: true, mutedUntilRound: true },
  });
  const from = existing?.state ?? 'idle';

  if (action === 'mute' || action === 'kick') {
    const result = roleTransition(from, action === 'mute' ? 'MUTE' : 'REMOVE');
    if (!result.ok) throw new Conflict(`角色当前状态 ${from} 不接受 ${action}：${result.reason}`);

    const round = await currentRoundOf(runId);
    const data =
      action === 'mute'
        ? { state: 'muted' as const, mutedUntilRound: round + durationRounds }
        : { state: 'removed' as const, mutedUntilRound: 0 };
    await prisma.runAgentState.upsert({
      where: { runId_roleId: { runId, roleId } },
      update: data,
      create: { runId, roleId, ...data },
    });
    return { state: data.state, mutedUntilRound: data.mutedUntilRound ?? 0 };
  }

  return { state: from, mutedUntilRound: existing?.mutedUntilRound ?? 0 };
}

async function revertRoleEffect(
  roomId: string,
  roleId: string,
  action: ModerationAction,
): Promise<string> {
  const runId = await activeRunId(roomId);
  if (!runId) return 'idle';
  const existing = await prisma.runAgentState.findUnique({
    where: { runId_roleId: { runId, roleId } },
    select: { state: true },
  });
  const from = existing?.state ?? 'idle';

  // 撤销移出只清撤销标记：恢复发言必须重新添加角色（permissions §4）
  if (action === 'kick') return from;
  if (action !== 'mute' && action !== 'remind' && action !== 'warn') return from;

  const result = roleTransition(from, 'UNMUTE');
  if (from === 'muted' && result.ok) {
    await prisma.runAgentState.update({
      where: { runId_roleId: { runId, roleId } },
      data: { state: 'idle', mutedUntilRound: 0 },
    });
    await roomBroadcastState(runId, roomId, roleId, 'idle');
    return 'idle';
  }
  return from;
}

async function roomBroadcastState(runId: string, roomId: string, roleId: string, state: 'idle'): Promise<void> {
  roomGateway.broadcast(roomId, { type: 'role_state', payload: { runId, roleId, state } });
}

/**
 * 房主手动治理与撤销（mvp-spec §3.5 + 验收 #5）。
 *
 * 修复前身份可以从 `x-user-id` 头里随便挑，撤销还把原治理事件当已撤销覆盖掉。
 * 现在：操作者只来自 JWT；撤销保留原事件并写 revertedBy/revertedAt，可追溯。
 */
export const moderationPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/rooms/:roomId/events', async (request) => {
    const { roomId } = request.params as { roomId: string };
    await roomAccess(request, roomId, 'member');
    return prisma.moderationEvent.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, displayName: true } },
        revoker: { select: { id: true, displayName: true } },
        evidenceMessage: { select: { id: true, content: true, sequence: true } },
        targetRole: { select: { id: true, name: true } },
        targetUser: { select: { id: true, displayName: true } },
      },
    });
  });

  fastify.post('/rooms/:roomId/moderation', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const access = await roomAccess(request, roomId, 'owner');
    const parsed = ModerationActionInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }
    const { action, reason, targetRoleId, targetUserId, evidenceMessageId } = parsed.data;
    if (!targetRoleId && !targetUserId) {
      return reply.status(400).send({ error: 'target_required' });
    }

    if (targetRoleId) {
      const role = await prisma.roomRole.findFirst({ where: { id: targetRoleId, roomId }, select: { id: true } });
      if (!role) return reply.status(400).send({ error: 'role_not_in_room' });
    }
    if (evidenceMessageId) {
      // 证据必须来自本房间，否则等于把别人的消息挂来做"依据"
      const evidence = await prisma.message.findFirst({
        where: { id: evidenceMessageId, roomId },
        select: { id: true },
      });
      if (!evidence) return reply.status(400).send({ error: 'evidence_not_in_room' });
    }

    let durationRounds = parsed.data.durationRounds;
    if (action === 'mute' && !durationRounds) {
      const runId = await activeRunId(roomId);
      const settings = runId
        ? ((await prisma.discussionRun.findUnique({ where: { id: runId }, select: { settings: true } }))?.settings as
            | { defaultMuteRounds?: number }
            | null)
        : null;
      durationRounds = settings?.defaultMuteRounds ?? 3;
    }

    // permissions §4：移出前必须已有未被撤销的警告或禁言记录
    if (action === 'kick' && targetRoleId) {
      const prior = await prisma.moderationEvent.count({
        where: { roomId, targetRoleId, action: { in: ['warn', 'mute'] }, revertedAt: null },
      });
      if (prior === 0) {
        return reply.status(409).send({ error: 'kick_requires_prior_warning' });
      }
    }

    const applied =
      action === 'mute' || action === 'kick'
        ? await applyRoleEffect(roomId, targetRoleId ?? '', action, durationRounds ?? 3)
        : { state: '', mutedUntilRound: 0 };

    const event = await prisma.moderationEvent.create({
      data: {
        roomId,
        runId: await activeRunId(roomId),
        actorType: 'owner',
        actorId: access.user.id,
        targetType: targetRoleId ? 'role' : 'user',
        targetRoleId,
        targetUserId,
        action,
        reason,
        evidenceMessageId: evidenceMessageId ?? null,
        evidenceMessageIds: evidenceMessageId ? [evidenceMessageId] : [],
        durationRounds: action === 'mute' ? (durationRounds ?? 3) : null,
        penaltyLevel: ACTION_LEVEL[action],
        createdBy: access.user.id,
      },
    });

    if (targetRoleId) {
      await prisma.penaltyState.upsert({
        where: { roomId_targetRoleId: { roomId, targetRoleId } },
        update: { level: Math.max(ACTION_LEVEL[action], 0), lastEventId: event.id },
        create: {
          roomId,
          targetRoleId,
          level: ACTION_LEVEL[action],
          lastEventId: event.id,
          lastRunId: event.runId,
        },
      });
    }

    const notice = await appendRoomMessage(prisma, {
      roomId,
      runId: event.runId,
      senderType: 'moderator',
      content: `治理动作：${ACTION_LABELS[action]}${targetRoleId ? `（角色 ${targetRoleId}）` : ''}，理由：${reason}`,
    });

    roomGateway.broadcast(roomId, {
      type: 'moderation_event',
      payload: {
        event: ModerationEventSchema.parse(event),
        // 契约里 notice 是可选字段（undefined），不是可空字段，所以要 ?? undefined
        notice: (await messagePayload(notice.id)) ?? undefined,
      },
    });

    return reply.status(201).send({
      event,
      noticeMessageId: notice.id,
      roleState: applied.state || undefined,
      mutedUntilRound: applied.mutedUntilRound || undefined,
    });
  });

  fastify.post('/rooms/:roomId/events/:eventId/revoke', async (request, reply) => {
    const { roomId, eventId } = request.params as { roomId: string; eventId: string };
    const access = await roomAccess(request, roomId, 'owner');

    const event = await prisma.moderationEvent.findFirst({
      where: { id: eventId, roomId },
      select: { id: true, action: true, targetRoleId: true, revertedAt: true },
    });
    if (!event) return reply.status(404).send({ error: 'event_not_found' });
    if (event.revertedAt) return reply.status(409).send({ error: 'already_revoked' });

    // 不删除也不改写原事件：撤销只追加撤销人与撤销时间，原 action 必须留住，
    // 否则"当初做了什么处置"就查不回来了（验收 #5）
    const updated = await prisma.moderationEvent.update({
      where: { id: event.id },
      data: {
        revertedAt: new Date(),
        revertedBy: access.user.id,
      },
    });

    if (event.targetRoleId) {
      await revertRoleEffect(roomId, event.targetRoleId, event.action);
      await prisma.penaltyState.updateMany({
        where: { roomId, targetRoleId: event.targetRoleId },
        data: { level: 0, lastEventId: updated.id },
      });
    }

    const notice = await appendRoomMessage(prisma, {
      roomId,
      runId: updated.runId,
      senderType: 'moderator',
      content: `治理动作已撤销：${ACTION_LABELS[event.action]}。`,
    });

    roomGateway.broadcast(roomId, {
      type: 'moderation_event',
      payload: {
        event: ModerationEventSchema.parse(updated),
        // 契约里 notice 是可选字段（undefined），不是可空字段，所以要 ?? undefined
        notice: (await messagePayload(notice.id)) ?? undefined,
      },
    });

    return { event: updated, noticeMessageId: notice.id };
  });
};
