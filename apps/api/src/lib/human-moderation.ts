import { prisma } from '@tianma/database';
import { detectViolations, type DetectionInput } from '@tianma/ai-core';
import {
  MessageSchema,
  ModerationEventSchema,
  ModeratorRuleSchema,
  PenaltyLadderSchema,
  type ModeratorRule,
  type PenaltyLadder,
} from '@tianma/contracts';
import { roomGateway } from '../ws/room-gateway';

/**
 * 对人类发言做治理检测。
 *
 * AI 角色的治理在 Worker 侧（ModeratorRuntime）完成；人类发言在 API 创建，
 * 因此治理也必须在 API 侧跑。逻辑与 ModeratorRuntime 保持一致：
 * 取策略 → 检测 → 命中则写治理事件 + 广播。
 *
 * 处罚阶梯对人类简化：不要求"前置警告"，直接按阶梯游标推进。
 * 人类处罚落 PenaltyState.userId 维度（targetRoleId 为 null）。
 */
export async function moderateHumanMessage(params: {
  roomId: string;
  runId: string | null;
  messageId: string;
  userId: string;
}): Promise<void> {
  const { roomId, runId, messageId, userId } = params;

  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { moderatorEnabled: true } });
  if (!room?.moderatorEnabled) return;

  const policy = await prisma.moderatorPolicy.findFirst({
    where: { roomId },
    orderBy: { version: 'desc' },
  });
  if (!policy) return;

  const rules = parseRules(policy.rules);
  const enabled = rules.filter((rule) => rule.enabled);
  if (enabled.length === 0) return;

  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) return;

  const recent = await prisma.message.findMany({
    where: { runId, status: 'completed' },
    orderBy: { sequence: 'desc' },
    take: 12,
    select: { id: true, sequence: true, roleId: true, content: true },
  });

  const detection: DetectionInput = {
    rules: enabled,
    subject: { messageId: message.id, sequence: message.sequence, roleId: null, content: message.content },
    recent: recent
      .filter((m) => m.id !== messageId)
      .map((m) => ({ messageId: m.id, sequence: m.sequence, roleId: m.roleId, content: m.content })),
    consecutiveTurns: 0,
    maxConsecutiveTurns: 2,
    repetitionThreshold: 3,
    relevance: null,
  };

  const { primary } = detectViolations(detection);
  if (!primary) return;

  const ladder = parseLadder(policy.ladder);
  const currentLevel = await getCurrentHumanPenaltyLevel(roomId, userId);
  const idx = Math.min(Math.max(0, currentLevel), ladder.length - 1);
  const action = ladder[idx];
  const nextLevel = Math.min(ladder.length, idx + 1);

  const event = await prisma.moderationEvent.create({
    data: {
      roomId,
      runId,
      actorType: 'moderator',
      targetType: 'user',
      targetUserId: userId,
      action,
      reason: primary.explanation,
      matchedRule: primary.ruleId,
      policyVersion: policy.version,
      evidenceMessageIds: primary.evidenceMessageIds,
      durationRounds: action === 'mute' ? 3 : null,
      penaltyLevel: nextLevel,
      createdBy: 'system',
    },
  });

  const existing = await prisma.penaltyState.findFirst({
    where: { roomId, targetRoleId: null, targetUserId: userId },
  });
  if (existing) {
    await prisma.penaltyState.update({
      where: { id: existing.id },
      data: { level: nextLevel, lastEventId: event.id },
    });
  } else {
    await prisma.penaltyState.create({
      data: { roomId, targetUserId: userId, level: nextLevel, lastEventId: event.id, lastRunId: runId },
    });
  }

  const notice = `治理动作：人类成员 命中规则 ${primary.ruleId}·${primary.label}。判定说明：${primary.explanation}。`;
  const noticeMessage = await prisma.message.create({
    data: { roomId, runId, senderType: 'moderator', content: notice, status: 'completed', sequence: 0 },
  });

  roomGateway.broadcast(roomId, {
    type: 'moderation_event',
    payload: {
      event: ModerationEventSchema.parse(event),
      notice: MessageSchema.parse(noticeMessage),
    },
  });
}

async function getCurrentHumanPenaltyLevel(roomId: string, userId: string): Promise<number> {
  const state = await prisma.penaltyState.findFirst({
    where: { roomId, targetRoleId: null, targetUserId: userId },
    select: { level: true },
  });
  return state?.level ?? 0;
}

function parseRules(raw: unknown): ModeratorRule[] {
  const parsed = Array.isArray(raw) ? raw : [];
  return parsed.flatMap((entry) => {
    const result = ModeratorRuleSchema.safeParse(entry);
    if (!result.success) return [];
    return [result.data];
  });
}

function parseLadder(raw: unknown): PenaltyLadder {
  const result = PenaltyLadderSchema.safeParse(Array.isArray(raw) ? raw : undefined);
  return result.success ? result.data : ['remind', 'warn', 'mute', 'kick'];
}
