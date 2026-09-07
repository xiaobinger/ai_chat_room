import {
  decideLadderAction,
  detectViolations,
  roleTransition,
  type DetectionInput,
  type RuleHit,
} from '@tianma/ai-core';
import {
  MessageSchema,
  ModerationEventSchema,
  ModeratorRuleSchema,
  PenaltyLadderSchema,
  type ModeratorRule,
  type PenaltyLadder,
  type RoomEvent,
  type RunSettings,
} from '@tianma/contracts';
import type { AgentStateRecord, ClaimedRun, ModerationRecord, RoomRoleRecord, RunStore } from './db';
import type { ModelResolver } from './registry';

/** 刚落库、待评估的那条 AI 发言。 */
export interface SubjectMessage {
  messageId: string;
  sequence: number;
  roleId: string;
  content: string;
}

export interface ModeratorOutcome {
  hit: RuleHit;
  action: string;
  mutedUntilRound: number | null;
}

const ACTION_LABELS = {
  remind: '提醒',
  warn: '警告',
  mute: '限时禁言',
  kick: '移出',
  revoke: '撤销',
} as const;

/** 重复检测的滑动窗口条数。太小会漏，太大会把正常呼应判成刷屏。 */
const REPEAT_WINDOW = 12;

/**
 * AI 管理员的运行时：检测 + 阶梯 + 执行 + 审计，内联在导演循环里，不开新进程。
 *
 * 检测刻意做成"混合"的（决策 004）：重复、霸占、禁区关键词是纯确定性信号，
 * LLM 主题相关度只是其中一路输入。这样即使端点质量差或干脆不可用，
 * 验收 #2 依然能稳定复现出含规则、证据、动作的治理事件。
 */
export class ModeratorRuntime {
  private readonly repo: RunStore;
  private readonly registry: ModelResolver;
  private readonly publish: (event: RoomEvent) => Promise<void>;
  private readonly log: (message: string) => void;

  constructor(deps: {
    repo: RunStore;
    registry: ModelResolver;
    publish: (event: RoomEvent) => Promise<void>;
    log: (message: string) => void;
  }) {
    this.repo = deps.repo;
    this.registry = deps.registry;
    this.publish = deps.publish;
    this.log = deps.log;
  }

  async evaluate(args: {
    run: ClaimedRun;
    role: RoomRoleRecord;
    state: AgentStateRecord;
    subject: SubjectMessage;
    settings: RunSettings;
  }): Promise<ModeratorOutcome | null> {
    if (!args.run.moderatorEnabled) return null;

    const policy = await this.repo.getActivePolicy(args.run.roomId);
    if (!policy) {
      this.log('房间启用了 AI 管理员但还没有发布策略，跳过治理检测');
      return null;
    }

    const rules = parseRules(policy.rules);
    const ladder = parseLadder(policy.ladder);
    const enabled = rules.filter((rule) => rule.enabled);
    if (enabled.length === 0) return null;

    const role = args.role;
    const state = args.state;

    const detection: DetectionInput = {
      rules: enabled,
      subject: { ...args.subject },
      recent: (await this.repo.getRecentAgentContents(args.run.id, REPEAT_WINDOW)).map((row) => ({
        messageId: row.messageId,
        sequence: row.sequence,
        roleId: row.roleId,
        content: row.content,
      })),
      consecutiveTurns: state.consecutiveTurns,
      maxConsecutiveTurns: args.settings.maxConsecutiveTurns,
      repetitionThreshold: args.settings.repetitionThreshold,
      // 只有真的配了 off_topic 规则才花这一次模型调用
      relevance: enabled.some((rule) => rule.kind === 'off_topic')
        ? await this.scoreRelevance(args.run, role, args.subject.content)
        : null,
    };

    const { primary } = detectViolations(detection);
    if (!primary) return null;

    const level = await this.repo.getPenaltyLevel(args.run.roomId, role.id);
    const decision = decideLadderAction({
      ladder,
      level,
      hit: primary,
      currentRound: args.run.currentRound,
      defaultMuteRounds: args.settings.defaultMuteRounds,
      hasPriorWarnOrMute: await this.repo.hasPriorWarnOrMute(args.run.roomId, role.id),
    });

    const roleState = await this.applyRoleState(args.run, role, state, decision.action, decision.mutedUntilRound);

    const notice = buildNotice(role.name, primary, decision.action, decision, args.run.currentRound);

    const record = await this.repo.recordModeration({
      roomId: args.run.roomId,
      runId: args.run.id,
      targetRoleId: role.id,
      createdBy: args.run.createdBy,
      action: decision.action,
      reason: `${primary.explanation}（${decision.note}）`,
      matchedRule: primary.ruleId,
      policyVersion: policy.version,
      evidenceMessageIds: primary.evidenceMessageIds,
      durationRounds: decision.mutedUntilRound === null ? null : decision.mutedUntilRound - args.run.currentRound,
      penaltyLevel: decision.nextLevel,
      notice,
      roleState,
    });

    // 事件与角色态已经落库；广播只是尽力通知在线客户端。
    // 两者必须分开对待，否则会出现"数据是对的、日志说失败、界面没收到"三方各说各话。
    await this.notify(args.run, role, record, roleState);

    this.log(`治理：角色 ${role.name} 命中 ${primary.ruleId}（${primary.kind}）-> ${decision.action}`);
    return {
      hit: primary,
      action: decision.action,
      mutedUntilRound: decision.mutedUntilRound,
    };
  }

  private async scoreRelevance(
    run: ClaimedRun,
    role: RoomRoleRecord,
    content: string,
  ): Promise<number | null> {
    try {
      return await this.registry.resolve(role.modelName).scoreRelevance({
        topic: run.topic,
        goal: run.goal || undefined,
        content,
        timeoutMs: 10_000,
      });
    } catch {
      // 模型名配错等解析失败不该让整场治理检测崩掉，弃权即可
      return null;
    }
  }

  /** 提醒与警告不改变调度资格（permissions §4），所以只有禁言/移出才写角色态。 */
  private async applyRoleState(
    run: ClaimedRun,
    role: RoomRoleRecord,
    state: AgentStateRecord,
    action: string,
    mutedUntilRound: number | null,
  ): Promise<{ state: AgentStateRecord['state']; mutedUntilRound: number } | null> {
    if (action !== 'mute' && action !== 'kick') return null;
    const from = state.state;
    const event = action === 'mute' ? 'MUTE' : 'REMOVE';
    if (!roleTransition(from, event).ok) {
      this.log(`角色 ${role.name} 处于 ${from}，无法执行 ${action}，仅记录事件`);
      return null;
    }
    return {
      state: action === 'mute' ? 'muted' : 'removed',
      mutedUntilRound: action === 'mute' ? (mutedUntilRound ?? run.currentRound) : 0,
    };
  }

  private async notify(
    run: ClaimedRun,
    role: RoomRoleRecord,
    record: ModerationRecord,
    roleState: { state: AgentStateRecord['state']; mutedUntilRound: number } | null,
  ): Promise<void> {
    try {
      await this.publish({
        roomId: run.roomId,
        event: {
          type: 'moderation_event',
          payload: {
            event: ModerationEventSchema.parse(record.event),
            notice: await this.messagePayload(record.noticeMessageId),
          },
        },
      });
      if (roleState) {
        await this.publish({
          roomId: run.roomId,
          event: {
            type: 'role_state',
            payload: { runId: run.id, roleId: role.id, state: roleState.state },
          },
        });
      }
    } catch (error) {
      this.log(`治理事件已落库但广播失败（不影响数据）：${(error as Error).message}`);
    }
  }

  private async messagePayload(messageId: string) {
    const row = await this.repo.messageForEvent(messageId);
    return row ? MessageSchema.parse(row) : undefined;
  }
}

function parseRules(raw: unknown): ModeratorRule[] {
  const parsed = Array.isArray(raw) ? raw : [];
  return parsed.flatMap((entry) => {
    const result = ModeratorRuleSchema.safeParse(entry);
    // 单条规则不合契约就丢掉并留痕，绝不让整场讨论因为一处坏配置停摆
    if (!result.success) {
      console.warn(`[moderator] 忽略无效规则：${JSON.stringify(entry).slice(0, 120)}`);
      return [];
    }
    return [result.data];
  });
}

function parseLadder(raw: unknown): PenaltyLadder {
  const result = PenaltyLadderSchema.safeParse(Array.isArray(raw) ? raw : undefined);
  return result.success ? result.data : ['remind', 'warn', 'mute', 'kick'];
}

/** 验收 #2 要求事件同时显示命中规则、证据、判定说明、动作与时长，这里一次性拼全。 */
function buildNotice(
  roleName: string,
  hit: RuleHit,
  action: string,
  decision: { mutedUntilRound: number | null; note: string },
  currentRound: number,
): string {
  const duration =
    decision.mutedUntilRound === null
      ? ''
      : `，时长 ${decision.mutedUntilRound - currentRound} 轮（第 ${decision.mutedUntilRound} 轮解禁）`;
  return `治理动作：${roleName} 命中规则 ${hit.ruleId}·${hit.label}。判定说明：${hit.explanation}。处置：${ACTION_LABELS[action as keyof typeof ACTION_LABELS] ?? action}${duration}。`;
}
