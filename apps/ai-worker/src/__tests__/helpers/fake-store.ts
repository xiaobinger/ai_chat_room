import { randomUUID } from 'node:crypto';
import { DEFAULT_RUN_SETTINGS, type RunSettings, type SummaryPayload } from '@tianma/contracts';
import type {
  ActivePolicy,
  AgentStateRecord,
  AppendMessageInput,
  ClaimedRun,
  ContextRecord,
  ModerationRecord,
  RecordModerationInput,
  RoomRoleRecord,
  RunPatch,
  RunStore,
  StoredMessage,
} from '../../db';
import type { GovernanceRecord, TranscriptMessage } from '../../summarizer';

/**
 * 内存版 RunStore，用来在不起 MySQL 的情况下测调度循环。
 *
 * 它刻意复刻真实存储的三个语义，否则测试会给出假绿灯：
 * 1. 读出来的是副本 —— 真数据库每次查询都返回新行，改对象不会改到库里；
 * 2. commitRun 带 leaseToken + version 双条件，冲突返回 false；
 * 3. 序号由房间级计数器发出，不是数组长度。
 */
export class FakeStore implements RunStore {
  runs = new Map<string, ClaimedRun>();
  /** 租约到期时刻（ms）。ClaimedRun 里没有这一列，假实现单独记。 */
  private leaseExpiry = new Map<string, number>();
  roles: RoomRoleRecord[] = [];
  states = new Map<string, AgentStateRecord>();
  messages: StoredMessage[] = [];
  audits: { runId: string; round: number; payload: unknown }[] = [];
  messageSeq = 0;
  clock = () => Date.now();
  /** seedRun 的 settings 基准；测试用它注入自定义预算而不必每次手写。 */
  defaultSettings: RunSettings = { ...DEFAULT_RUN_SETTINGS };

  private stateKey(runId: string, roleId: string): string {
    return `${runId}:${roleId}`;
  }

  private leaseHeld(runId: string): boolean {
    const expires = this.leaseExpiry.get(runId);
    return expires !== undefined && expires > this.clock();
  }

  /** 测试里手动让租约到期，模拟 Worker 卡死后的接管。 */
  expireLease(runId: string): void {
    this.leaseExpiry.set(runId, this.clock() - 1);
  }

  /** 精确复刻"房主暂停 -> API 收回租约"：leaseToken 置空，租约即刻失效。 */
  forceRelease(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.runs.set(runId, { ...run, leaseToken: null });
    this.leaseExpiry.delete(runId);
  }

  /** 测试里模拟另一个进程已经持有这个 Run。 */
  stealLease(runId: string, token = 'other-worker'): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.runs.set(runId, { ...run, leaseToken: token });
    this.leaseExpiry.set(runId, this.clock() + 60_000);
  }

  seedRun(run: Partial<ClaimedRun> & { id: string; roomId: string }): void {
    this.runs.set(run.id, {
      completionCriteria: '',
      goal: '',
      moderatorEnabled: false,
      mode: 'structured',
      status: 'queued',
      currentRound: 0,
      settings: { ...this.defaultSettings, ...(run.settings ?? {}) },
      topic: '测试主题',
      version: 0,
      leaseToken: null,
      terminationReason: null,
      createdBy: 'owner-1',
      startedAt: null,
      ...run,
    } as ClaimedRun);
  }

  seedRoles(roles: (Partial<RoomRoleRecord> & { id: string; roomId: string })[]): void {
    for (const role of roles) {
      this.roles.push({
        aggressiveness: 50,
        modelName: 'mock',
        name: role.id,
        priority: 50,
        stance: '',
        systemPrompt: '你是测试角色',
        type: 'debater',
        ...role,
      });
    }
  }

  patch(runId: string, data: Partial<ClaimedRun>): void {
    const run = this.runs.get(runId);
    if (run) this.runs.set(runId, { ...run, ...data });
  }

  async claimRun(runId: string, leaseToken: string, leaseMs: number): Promise<ClaimedRun | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    if (run.status !== 'queued' && run.status !== 'running') return null;
    if (this.leaseHeld(runId)) return null;

    const now = this.clock();
    this.runs.set(runId, {
      ...run,
      status: 'running',
      leaseToken,
      version: run.version + 1,
      startedAt: run.startedAt ?? new Date(now),
    });
    this.leaseExpiry.set(runId, now + leaseMs);
    return this.getRun(runId);
  }

  async getRun(runId: string): Promise<ClaimedRun | null> {
    const run = this.runs.get(runId);
    return run ? { ...run, settings: { ...run.settings } } : null;
  }

  async renewLease(runId: string, leaseToken: string, leaseMs: number): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run || run.leaseToken !== leaseToken || !this.leaseHeld(runId)) return false;
    this.leaseExpiry.set(runId, this.clock() + leaseMs);
    return true;
  }

  async releaseLease(runId: string, leaseToken: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.leaseToken !== leaseToken) return;
    this.runs.set(runId, { ...run, leaseToken: null });
    this.leaseExpiry.delete(runId);
  }

  async commitRun(
    runId: string,
    leaseToken: string,
    expectedVersion: number,
    patch: RunPatch,
  ): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run || run.leaseToken !== leaseToken || run.version !== expectedVersion) return false;
    this.runs.set(runId, {
      ...run,
      ...stripUndefined(patch),
      version: run.version + 1,
    });
    return true;
  }

  async appendMessage(input: AppendMessageInput): Promise<{ id: string; sequence: number }> {
    this.messageSeq += 1;
    const created: StoredMessage = {
      // 用真 uuid：假实现给出不合契约的 id，会让真实代码里的 schema 校验分支永远测不到
      id: randomUUID(),
      roomId: input.roomId,
      runId: input.runId,
      sequence: this.messageSeq,
      senderType: input.senderType,
      senderId: input.senderId ?? null,
      roleId: input.roleId ?? null,
      content: input.content,
      status: input.status ?? 'completed',
      tokens: input.tokens ?? null,
      createdAt: new Date(this.clock()),
    };
    this.messages.push(created);
    return { id: created.id, sequence: created.sequence };
  }

  async sumRunTokens(runId: string): Promise<number> {
    return this.messages
      .filter((message) => message.runId === runId)
      .reduce((sum, message) => sum + (message.tokens ?? 0), 0);
  }

  async getRoomRoles(roomId: string): Promise<RoomRoleRecord[]> {
    return this.roles.filter((role) => role.roomId === roomId).map((role) => ({ ...role }));
  }

  async ensureAgentStates(runId: string, roleIds: string[]): Promise<AgentStateRecord[]> {
    for (const roleId of roleIds) {
      const key = this.stateKey(runId, roleId);
      if (!this.states.has(key)) {
        this.states.set(key, {
          roleId,
          state: 'idle',
          mutedUntilRound: 0,
          consecutiveTurns: 0,
          errorCount: 0,
          lastErrorRound: -1,
          lastSpokeRound: -1,
        });
      }
    }
    return this.getAgentStates(runId);
  }

  async getAgentStates(runId: string): Promise<AgentStateRecord[]> {
    const prefix = `${runId}:`;
    return [...this.states.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, state]) => ({ ...state, roleId: key.slice(prefix.length) }));
  }

  async saveAgentState(
    runId: string,
    roleId: string,
    data: Partial<Omit<AgentStateRecord, 'roleId'>>,
  ): Promise<void> {
    const key = this.stateKey(runId, roleId);
    const existing = this.states.get(key);
    this.states.set(key, {
      ...(existing ?? {
        roleId,
        state: 'idle' as const,
        mutedUntilRound: 0,
        consecutiveTurns: 0,
        errorCount: 0,
        lastErrorRound: -1,
        lastSpokeRound: -1,
      }),
      ...data,
      roleId,
    });
  }

  async hasRecentHumanMessage(runId: string, lookback: number): Promise<boolean> {
    return this.messages
      .filter((message) => message.runId === runId && message.senderType === 'user' && message.status === 'completed')
      .slice(-lookback)
      .length > 0;
  }

  async getContext(runId: string, limit: number): Promise<ContextRecord[]> {
    const roleName = (roleId: string | null): string =>
      this.roles.find((role) => role.id === roleId)?.name ?? '系统';
    return this.messages
      .filter((message) => message.runId === runId && message.status === 'completed')
      .slice(-limit)
      .map((message) => ({
        sequence: message.sequence,
        speaker: roleName(message.roleId),
        content: message.content,
        roleId: message.roleId,
      }));
  }

  async saveScheduleAudit(runId: string, round: number, payload: unknown): Promise<void> {
    this.audits.push({ runId, round, payload });
  }

  async messageForEvent(id: string): Promise<StoredMessage | null> {
    return this.messages.find((message) => message.id === id) ?? null;
  }

  // ===== 治理 =====

  /** 版本 -> 策略。seedPolicy 写入，getActivePolicy 取最高版。 */
  policies: ActivePolicy[] = [];
  moderationEvents: ModerationRecord[] = [];
  private penaltyLevels = new Map<string, number>();

  seedPolicy(version: number, rules: unknown, ladder: unknown): void {
    this.policies.push({ version, rules, ladder });
  }

  private penaltyKey(roomId: string, roleId: string): string {
    return `${roomId}:${roleId}`;
  }

  async getActivePolicy(): Promise<ActivePolicy | null> {
    return [...this.policies].sort((a, b) => b.version - a.version)[0] ?? null;
  }

  async getRecentAgentContents(
    runId: string,
    limit: number,
  ): Promise<{ messageId: string; sequence: number; roleId: string | null; content: string }[]> {
    return this.messages
      .filter(
        (message) =>
          message.runId === runId && message.senderType === 'agent' && message.status === 'completed',
      )
      .slice(-limit)
      .map((message) => ({
        messageId: message.id,
        sequence: message.sequence,
        roleId: message.roleId,
        content: message.content,
      }));
  }

  async getPenaltyLevel(roomId: string, targetRoleId: string): Promise<number> {
    return this.penaltyLevels.get(this.penaltyKey(roomId, targetRoleId)) ?? 0;
  }

  async hasPriorWarnOrMute(roomId: string, targetRoleId: string): Promise<boolean> {
    return this.moderationEvents.some(
      (record) =>
        record.event.roomId === roomId &&
        record.event.targetRoleId === targetRoleId &&
        (record.event.action === 'warn' || record.event.action === 'mute') &&
        record.event.revertedAt === null,
    );
  }

  async recordModeration(input: RecordModerationInput): Promise<ModerationRecord> {
    const notice = await this.appendMessage({
      roomId: input.roomId,
      runId: input.runId,
      senderType: 'moderator',
      content: input.notice,
      status: 'completed',
    });

    const record: ModerationRecord = {
      event: {
        id: randomUUID(),
        roomId: input.roomId,
        runId: input.runId,
        actorType: 'moderator',
        actorId: null,
        targetType: 'role',
        targetRoleId: input.targetRoleId,
        targetUserId: null,
        action: input.action,
        reason: input.reason,
        matchedRule: input.matchedRule,
        policyVersion: input.policyVersion,
        evidenceMessageIds: input.evidenceMessageIds,
        evidenceMessageId: input.evidenceMessageIds[0] ?? null,
        durationRounds: input.durationRounds,
        penaltyLevel: input.penaltyLevel,
        createdBy: input.createdBy,
        createdAt: new Date(this.clock()),
        revertedAt: null,
        revertedBy: null,
      },
      noticeMessageId: notice.id,
    };
    this.moderationEvents.push(record);
    this.penaltyLevels.set(this.penaltyKey(input.roomId, input.targetRoleId), input.penaltyLevel);

    // 与真实实现一致：处置改变了角色态就必须立刻反映到状态里
    if (input.roleState) {
      await this.saveAgentState(input.runId, input.targetRoleId, {
        state: input.roleState.state,
        mutedUntilRound: input.roleState.mutedUntilRound,
      });
    }
    return record;
  }

  // ===== 复盘 =====

  summaries: {
    runId: string;
    payload: SummaryPayload;
    sourceMessageIds: string[];
    status: string;
    error: string | null;
  }[] = [];

  async getRunTranscript(runId: string): Promise<TranscriptMessage[]> {
    const roleName = (roleId: string | null): string =>
      this.roles.find((role) => role.id === roleId)?.name ?? '系统';
    return this.messages
      .filter((message) => message.runId === runId && message.status === 'completed')
      .map((message) => ({
        id: message.id,
        sequence: message.sequence,
        senderType: message.senderType,
        roleId: message.roleId,
        speaker: roleName(message.roleId),
        content: message.content,
        createdAt: message.createdAt,
      }));
  }

  async getRunModeration(runId: string): Promise<GovernanceRecord[]> {
    return this.moderationEvents
      .filter((record) => record.event.runId === runId)
      .map((record) => ({
        id: record.event.id,
        action: record.event.action,
        reason: record.event.reason,
        matchedRule: record.event.matchedRule,
        policyVersion: record.event.policyVersion,
        targetRoleId: record.event.targetRoleId,
        durationRounds: record.event.durationRounds,
        evidenceMessageIds: record.event.evidenceMessageIds,
      }));
  }

  async saveSummary(
    runId: string,
    payload: unknown,
    sourceMessageIds: string[],
    status: 'pending' | 'generating' | 'ready' | 'failed',
    error: string | null,
  ): Promise<{ id: string }> {
    this.summaries = this.summaries.filter((entry) => entry.runId !== runId);
    const id = `summary-${this.summaries.length + 1}`;
    this.summaries.push({
      runId,
      payload: payload as SummaryPayload,
      sourceMessageIds,
      status,
      error,
    });
    return { id };
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key as keyof T] = entry as T[keyof T];
  }
  return out;
}

export function settings(overrides: Partial<RunSettings> = {}): RunSettings {
  return { ...DEFAULT_RUN_SETTINGS, ...overrides };
}
