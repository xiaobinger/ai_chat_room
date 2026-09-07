import type {
  DiscussionMode,
  MessageSenderType,
  MessageStatus,
  RoleRunState,
  RunSettings,
  RunStatus,
  RunTerminationReason,
} from '@tianma/contracts';
import { appendRoomMessage, createRoomMessage, prisma, type Prisma } from '@tianma/database';
import type { ModerationEvent as ModerationEventRow } from '@tianma/database';
import type { GovernanceRecord, TranscriptMessage } from './summarizer';

export interface ClaimedRun {
  id: string;
  roomId: string;
  topic: string;
  goal: string;
  completionCriteria: string;
  status: RunStatus;
  currentRound: number;
  settings: RunSettings;
  version: number;
  terminationReason: RunTerminationReason | null;
  /** 当前持有者；Worker 用它判断"这次写还是不是我"。 */
  leaseToken: string | null;
  startedAt: Date | null;
  mode: DiscussionMode;
  moderatorEnabled: boolean;
  /** 发起该 Run 的房主，治理事件的审计归属 */
  createdBy: string;
}

export interface RoomRoleRecord {
  id: string;
  roomId: string;
  name: string;
  type: string;
  systemPrompt: string;
  modelName: string;
  stance: string;
  aggressiveness: number;
  priority: number;
}

export interface AgentStateRecord {
  roleId: string;
  state: RoleRunState;
  mutedUntilRound: number;
  consecutiveTurns: number;
  errorCount: number;
  lastErrorRound: number;
  lastSpokeRound: number;
}

export interface ContextRecord {
  sequence: number;
  speaker: string;
  content: string;
  roleId: string | null;
}

export interface AppendMessageInput {
  roomId: string;
  runId: string | null;
  senderType: MessageSenderType;
  senderId?: string | null;
  roleId?: string | null;
  content: string;
  status?: MessageStatus;
  tokens?: number | null;
}

export interface RunPatch {
  status?: RunStatus;
  currentRound?: number;
  terminationReason?: RunTerminationReason | null;
  endedAt?: Date | null;
  leaseToken?: string | null;
  leaseExpiresAt?: Date | null;
}

/**
 * RunRunner 实际用到的存储面。抽成接口是为了让调度循环能脱离数据库被测：
 * 租约抢占、轮次推进、暂停优先这些行为靠真 MySQL 测太慢，靠假实现才测得准。
 */
export interface RunStore {
  claimRun(runId: string, leaseToken: string, leaseMs: number): Promise<ClaimedRun | null>;
  getRun(runId: string): Promise<ClaimedRun | null>;
  renewLease(runId: string, leaseToken: string, leaseMs: number): Promise<boolean>;
  releaseLease(runId: string, leaseToken: string): Promise<void>;
  commitRun(runId: string, leaseToken: string, expectedVersion: number, patch: RunPatch): Promise<boolean>;
  appendMessage(input: AppendMessageInput): Promise<{ id: string; sequence: number }>;
  sumRunTokens(runId: string): Promise<number>;
  getRoomRoles(roomId: string): Promise<RoomRoleRecord[]>;
  ensureAgentStates(runId: string, roleIds: string[]): Promise<AgentStateRecord[]>;
  getAgentStates(runId: string): Promise<AgentStateRecord[]>;
  saveAgentState(
    runId: string,
    roleId: string,
    data: Partial<Omit<AgentStateRecord, 'roleId'>>,
  ): Promise<void>;
  getContext(runId: string, limit: number): Promise<ContextRecord[]>;
  saveScheduleAudit(runId: string, round: number, payload: unknown): Promise<void>;
  messageForEvent(id: string): Promise<StoredMessage | null>;
  getActivePolicy(roomId: string): Promise<ActivePolicy | null>;
  getRecentAgentContents(
    runId: string,
    limit: number,
  ): Promise<Array<{ messageId: string; sequence: number; roleId: string | null; content: string }>>;
  getPenaltyLevel(roomId: string, targetRoleId: string): Promise<number>;
  hasPriorWarnOrMute(roomId: string, targetRoleId: string): Promise<boolean>;
  recordModeration(input: RecordModerationInput): Promise<ModerationRecord>;
  getRunTranscript(runId: string): Promise<TranscriptMessage[]>;
  getRunModeration(runId: string): Promise<GovernanceRecord[]>;
  saveSummary(
    runId: string,
    payload: unknown,
    sourceMessageIds: string[],
    status: 'pending' | 'generating' | 'ready' | 'failed',
    error: string | null,
  ): Promise<{ id: string }>;
}

export interface ActivePolicy {
  version: number;
  rules: unknown;
  ladder: unknown;
}

export interface RecordModerationInput {
  roomId: string;
  runId: string;
  targetRoleId: string;
  /** 审计归属用户（发布该策略的房主），不是"执行者"；执行者看 actorType */
  createdBy: string;
  action: 'remind' | 'warn' | 'mute' | 'kick' | 'revoke';
  reason: string;
  matchedRule: string;
  policyVersion: number;
  evidenceMessageIds: string[];
  /** 禁言时长（轮次）；非禁言动作为 null */
  durationRounds: number | null;
  /** 处置后的阶梯游标 */
  penaltyLevel: number;
  /** 展示在房间消息流里的处置说明 */
  notice: string;
  /** 处置后角色的运行态；由调用方算好，保证事件与状态一致 */
  roleState: { state: RoleRunState; mutedUntilRound: number } | null;
}

/** 已落库的治理事件，够广播与审计用。 */
export interface ModerationRecord {
  event: Omit<ModerationEventRow, 'evidenceMessageIds'> & { evidenceMessageIds: string[] };
  noticeMessageId: string;
}

/** 广播 message 事件用的最小投影，字段与 contracts 的 MessageSchema 对齐。 */
export interface StoredMessage {
  id: string;
  roomId: string;
  runId: string | null;
  sequence: number;
  senderType: MessageSenderType;
  senderId: string | null;
  roleId: string | null;
  content: string;
  status: MessageStatus;
  tokens: number | null;
  createdAt: Date;
}

/**
 * Worker 侧的数据库写入全部走"条件更新"，绝不 read-then-write：
 * state-machines.md §1.4 要求版本冲突时重新读取而不是覆盖新状态。
 * 所有写还额外带 leaseToken 条件，租约被夺走的旧 Worker 永远写不进任何东西。
 */
export class RunRepository implements RunStore {
  async claimRun(runId: string, leaseToken: string, leaseMs: number): Promise<ClaimedRun | null> {
    const now = Date.now();
    const taken = await prisma.discussionRun.updateMany({
      where: {
        id: runId,
        status: { in: ['queued', 'running'] },
        // 已被别人持有且尚未过期 -> 抢不到
        OR: [{ leaseToken: null }, { leaseExpiresAt: { lt: new Date(now) } }],
      },
      data: {
        status: 'running',
        leaseToken,
        leaseExpiresAt: new Date(now + leaseMs),
        version: { increment: 1 },
      },
    });
    if (taken.count !== 1) return null;

    // startedAt 只在首次认领时写；条件更新而非读后判断，避免把已有时间戳覆盖掉
    await prisma.discussionRun.updateMany({
      where: { id: runId, startedAt: null },
      data: { startedAt: new Date(now) },
    });

    return this.getRun(runId);
  }

  async getRun(runId: string): Promise<ClaimedRun | null> {
    const run = await prisma.discussionRun.findUnique({
      where: { id: runId },
      include: { room: { select: { mode: true, moderatorEnabled: true } } },
    });
    if (!run) return null;
    return {
      id: run.id,
      roomId: run.roomId,
      topic: run.topic,
      goal: run.goal,
      completionCriteria: run.completionCriteria,
      status: run.status as RunStatus,
      currentRound: run.currentRound,
      settings: run.settings as unknown as RunSettings,
      version: run.version,
      terminationReason: run.terminationReason,
      leaseToken: run.leaseToken,
      startedAt: run.startedAt,
      mode: run.room.mode as DiscussionMode,
      moderatorEnabled: run.room.moderatorEnabled,
      createdBy: run.createdBy,
    };
  }

  /**
   * 续租。where 同时要求 leaseToken 匹配且未过期，
   * 所以返回 false 就等价于"这张 Run 已经不在我手里了"，调用方必须立即停写。
   */
  async renewLease(runId: string, leaseToken: string, leaseMs: number): Promise<boolean> {
    const updated = await prisma.discussionRun.updateMany({
      where: { id: runId, leaseToken, leaseExpiresAt: { gt: new Date() } },
      data: { leaseExpiresAt: new Date(Date.now() + leaseMs) },
    });
    return updated.count === 1;
  }

  /**
   * 带版本号的乐观提交。返回 false 表示版本已被推进（房主刚暂停 / 别的 Worker 刚写过），
   * 调用方必须重读并对账，绝不能强行覆盖。
   */
  async commitRun(runId: string, leaseToken: string, expectedVersion: number, patch: RunPatch): Promise<boolean> {
    const updated = await prisma.discussionRun.updateMany({
      where: { id: runId, leaseToken, version: expectedVersion },
      data: { ...patch, version: { increment: 1 } },
    });
    return updated.count === 1;
  }

  /** 释放租约但不动 status：暂停 / 让位给下一次入队时用。 */
  async releaseLease(runId: string, leaseToken: string): Promise<void> {
    await prisma.discussionRun.updateMany({
      where: { id: runId, leaseToken },
      data: { leaseToken: null, leaseExpiresAt: null },
    });
  }

  /**
   * 房间级序号发号与消息插入由 @tianma/database 统一实现，API 侧走同一条路径 ——
   * 两处各写一遍迟早会漂移出重复序号。
   */
  async appendMessage(input: AppendMessageInput): Promise<{ id: string; sequence: number }> {
    return appendRoomMessage(prisma, input);
  }

  async getAgentStates(runId: string): Promise<AgentStateRecord[]> {
    const states = await prisma.runAgentState.findMany({ where: { runId } });
    return states.map((state) => ({
      roleId: state.roleId,
      state: state.state,
      mutedUntilRound: state.mutedUntilRound,
      consecutiveTurns: state.consecutiveTurns,
      errorCount: state.errorCount,
      lastErrorRound: state.lastErrorRound,
      lastSpokeRound: state.lastSpokeRound,
    }));
  }

  /** mvp-spec §6：候选评分需留下可审计的因素。 */
  async saveScheduleAudit(runId: string, round: number, payload: unknown): Promise<void> {
    await prisma.runScheduleAudit.create({
      data: { runId, round, payload: payload as Prisma.InputJsonValue },
    });
  }

  async messageForEvent(id: string): Promise<Awaited<ReturnType<typeof prisma.message.findUnique>>> {
    return prisma.message.findUnique({ where: { id } });
  }

  async getRoomRoles(roomId: string): Promise<RoomRoleRecord[]> {
    const roles = await prisma.roomRole.findMany({ where: { roomId }, orderBy: { createdAt: 'asc' } });
    return roles.map((role) => ({
      id: role.id,
      roomId: role.roomId,
      name: role.name,
      type: role.type,
      systemPrompt: role.systemPrompt,
      modelName: role.modelName,
      stance: role.stance,
      aggressiveness: role.aggressiveness,
      priority: role.priority,
    }));
  }

  /** 为 Run 内尚未建档的角色补建 idle 状态，返回全部角色运行态。 */
  async ensureAgentStates(runId: string, roleIds: string[]): Promise<AgentStateRecord[]> {
    await prisma.runAgentState.createMany({
      data: roleIds.map((roleId) => ({ runId, roleId, state: 'idle' as const })),
      skipDuplicates: true,
    });
    return this.getAgentStates(runId);
  }

  async saveAgentState(
    runId: string,
    roleId: string,
    data: Partial<Omit<AgentStateRecord, 'roleId'>>,
  ): Promise<void> {
    await prisma.runAgentState.upsert({
      where: { runId_roleId: { runId, roleId } },
      update: data,
      create: { runId, roleId, ...data },
    });
  }

  /**
   * 回灌已消耗的 token。没有它，暂停后恢复或 Worker 重启就等于预算清零，
   * token_budget 这一维永远打不满。tokens 为 null 的行（历史遗留）按 0 计。
   */
  async sumRunTokens(runId: string): Promise<number> {
    const aggregated = await prisma.message.aggregate({
      where: { runId },
      _sum: { tokens: true },
    });
    return aggregated._sum.tokens ?? 0;
  }

  /** 只有 completed 消息能进入后续角色的正式上下文（state-machines.md §3）。 */
  async getContext(runId: string, limit: number): Promise<ContextRecord[]> {
    const messages = await prisma.message.findMany({
      where: { runId, status: 'completed' },
      orderBy: { sequence: 'desc' },
      take: limit,
      include: { role: { select: { name: true } } },
    });
    return messages.reverse().map((message) => ({
      sequence: message.sequence,
      speaker: message.role?.name ?? (message.senderType === 'user' ? '人类成员' : '系统'),
      content: message.content,
      roleId: message.roleId,
    }));
  }

  /** 最近若干条已完成发言，供重复检测取滑动窗口。 */
  async getRecentAgentContents(
    runId: string,
    limit: number,
  ): Promise<Array<{ messageId: string; sequence: number; roleId: string | null; content: string }>> {
    const messages = await prisma.message.findMany({
      where: { runId, status: 'completed', senderType: 'agent' },
      orderBy: { sequence: 'desc' },
      take: limit,
      select: { id: true, sequence: true, roleId: true, content: true },
    });
    return messages.reverse().map((message) => ({
      messageId: message.id,
      sequence: message.sequence,
      roleId: message.roleId,
      content: message.content,
    }));
  }

  async getActivePolicy(roomId: string): Promise<ActivePolicy | null> {
    const policy = await prisma.moderatorPolicy.findFirst({
      where: { roomId },
      orderBy: { version: 'desc' },
      select: { version: true, rules: true, ladder: true },
    });
    return policy ?? null;
  }

  async getPenaltyLevel(roomId: string, targetRoleId: string): Promise<number> {
    const state = await prisma.penaltyState.findUnique({
      where: { roomId_targetRoleId: { roomId, targetRoleId } },
      select: { level: true },
    });
    return state?.level ?? 0;
  }

  /** 复盘用全文：只取 completed，与喂给模型的上下文同一口径。 */
  async getRunTranscript(runId: string): Promise<TranscriptMessage[]> {
    const messages = await prisma.message.findMany({
      where: { runId, status: 'completed' },
      orderBy: { sequence: 'asc' },
      include: { role: { select: { name: true } } },
    });
    return messages.map((message) => ({
      id: message.id,
      sequence: message.sequence,
      senderType: message.senderType,
      roleId: message.roleId,
      speaker: message.role?.name ?? (message.senderType === 'user' ? '人类成员' : '系统'),
      content: message.content,
      createdAt: message.createdAt,
    }));
  }

  async getRunModeration(runId: string): Promise<GovernanceRecord[]> {
    const events = await prisma.moderationEvent.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        action: true,
        reason: true,
        matchedRule: true,
        policyVersion: true,
        targetRoleId: true,
        durationRounds: true,
        evidenceMessageIds: true,
      },
    });
    return events.map((event) => ({
      id: event.id,
      action: event.action,
      reason: event.reason,
      matchedRule: event.matchedRule,
      policyVersion: event.policyVersion,
      targetRoleId: event.targetRoleId,
      durationRounds: event.durationRounds,
      evidenceMessageIds: Array.isArray(event.evidenceMessageIds)
        ? (event.evidenceMessageIds as unknown[]).map(String)
        : [],
    }));
  }

  async saveSummary(
    runId: string,
    payload: unknown,
    sourceMessageIds: string[],
    status: 'pending' | 'generating' | 'ready' | 'failed',
    error: string | null,
  ): Promise<{ id: string }> {
    const saved = await prisma.discussionSummary.upsert({
      where: { runId },
      update: { payload: payload as Prisma.InputJsonValue, sourceMessageIds: sourceMessageIds as Prisma.InputJsonValue, status, error },
      create: {
        runId,
        payload: payload as Prisma.InputJsonValue,
        sourceMessageIds: sourceMessageIds as Prisma.InputJsonValue,
        status,
        error,
      },
      select: { id: true },
    });
    return { id: saved.id };
  }

  /** 该角色在本房间内是否已有警告或禁言记录（permissions §4 移出前置条件）。 */
  async hasPriorWarnOrMute(roomId: string, targetRoleId: string): Promise<boolean> {
    const count = await prisma.moderationEvent.count({
      where: { roomId, targetRoleId, action: { in: ['warn', 'mute'] }, revertedAt: null },
    });
    return count > 0;
  }

  /**
   * 一次处置的全部落盘动作，收在一个事务里：
   * 治理事件（含 §5 审计字段）+ 阶梯游标 + 角色运行态 + 消息流里的处置说明。
   *
   * 拆开写会出现两种不可接受的不一致："禁言已生效但查不到依据"，
   * 或"事件记了但角色还在继续发言"。验收 #2 与 #5 都要求这两件事对得上。
   */
  async recordModeration(input: RecordModerationInput): Promise<ModerationRecord> {
    return prisma.$transaction(async (tx) => {
      const event = await tx.moderationEvent.create({
        data: {
          roomId: input.roomId,
          runId: input.runId,
          actorType: 'moderator',
          actorId: null,
          targetType: 'role',
          targetRoleId: input.targetRoleId,
          action: input.action,
          reason: input.reason,
          matchedRule: input.matchedRule,
          policyVersion: input.policyVersion,
          evidenceMessageIds: input.evidenceMessageIds as Prisma.InputJsonValue,
          evidenceMessageId: input.evidenceMessageIds[0] ?? null,
          durationRounds: input.durationRounds,
          penaltyLevel: input.penaltyLevel,
          // createdBy 是 NOT NULL 的审计归属列。AI 管理员的处置权来自发布该策略的房主，
          // 所以记房主；"到底是 AI 还是人做的"由 actorType / actorId 表达。
          createdBy: input.createdBy,
        },
      });

      await tx.penaltyState.upsert({
        where: { roomId_targetRoleId: { roomId: input.roomId, targetRoleId: input.targetRoleId } },
        update: { level: input.penaltyLevel, lastRunId: input.runId, lastEventId: event.id },
        create: {
          roomId: input.roomId,
          targetRoleId: input.targetRoleId,
          level: input.penaltyLevel,
          lastRunId: input.runId,
          lastEventId: event.id,
        },
      });

      if (input.roleState) {
        await tx.runAgentState.upsert({
          where: { runId_roleId: { runId: input.runId, roleId: input.targetRoleId } },
          update: { state: input.roleState.state, mutedUntilRound: input.roleState.mutedUntilRound },
          create: {
            runId: input.runId,
            roleId: input.targetRoleId,
            state: input.roleState.state,
            mutedUntilRound: input.roleState.mutedUntilRound,
          },
        });
      }

      const notice = await createRoomMessage(tx, {
        roomId: input.roomId,
        runId: input.runId,
        senderType: 'moderator',
        content: input.notice,
        status: 'completed',
      });

      return {
        event: { ...event, evidenceMessageIds: input.evidenceMessageIds },
        noticeMessageId: notice.id,
      };
    });
  }
}
