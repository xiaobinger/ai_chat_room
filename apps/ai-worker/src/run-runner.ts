import { randomUUID } from 'node:crypto';
import type { RoomEvent, RunSettings, RunTerminationReason } from '@tianma/contracts';
import {
  BudgetTracker,
  parseRunSettings,
  roleTransition,
  runTransition,
  selectNextSpeaker,
  type CandidateFeatures,
  type SelectionAudit,
} from '@tianma/ai-core';
import { UnknownModelError, type ModelResolver } from './registry';
import { ModelCallError, type ContextTurn, type ModelProvider } from './model-provider';
import { ModeratorRuntime } from './moderator-runtime';
import { buildSummary } from './summarizer';
import type {
  AgentStateRecord,
  ClaimedRun,
  RoomRoleRecord,
  RunStore,
} from './db';

/** 喂给模型的上下文条数上限。太长会挤掉 maxTokensPerMessage 的输出空间。 */
const CONTEXT_WINDOW = 24;

/** 角色累计失败到这个次数就不再自动恢复 —— 那是配置问题，不是端点抖动。 */
const ROLE_ERROR_CEILING = 3;

/** 一次发言回合的结果。lost 表示租约或版本已不在手里，主循环必须退出。 */
type SpeakOutcome = 'spoke' | 'skipped' | 'lost';

export interface RunRunnerDeps {
  repo: RunStore;
  registry: ModelResolver;
  publish: (event: RoomEvent) => Promise<void>;
  log?: (message: string) => void;
}

/**
 * **轮次的定义**：规格未给死，这里固定为"一轮 = 场上每个可发言角色各发言一次"。
 * 只有这样才能同时解释界面上的 "3 位 AI 角色 · 第 7 / 20 轮"、"禁言 3 轮"
 * 以及导演的 silenceRounds。某角色是否已在本轮发言过，用持久化的
 * RunAgentState.lastSpokeRound 判定 —— 不新增列，进程崩溃后可自恢复。
 */
export class RunRunner {
  private readonly repo: RunStore;
  private readonly registry: ModelResolver;
  private readonly publish: (event: RoomEvent) => Promise<void>;
  private readonly log: (message: string) => void;
  private readonly moderator: ModeratorRuntime;

  constructor(deps: RunRunnerDeps) {
    this.repo = deps.repo;
    this.registry = deps.registry;
    this.publish = deps.publish;
    this.log = deps.log ?? ((message) => console.log(`[runner] ${message}`));
    this.moderator = new ModeratorRuntime({
      repo: this.repo,
      registry: this.registry,
      publish: this.publish,
      log: this.log,
    });
  }

  /** 租约必须比"最慢一次发言（含重试）"更长，否则模型慢一点就会被别的 Worker 抢走。 */
  private leaseMsFor(settings: RunSettings): number {
    return (settings.aiTimeoutSeconds * (settings.maxRetries + 1) + 30) * 1000;
  }

  async consume(runId: string): Promise<void> {
    const probe = await this.repo.getRun(runId);
    if (!probe) {
      this.log(`run ${runId} 不存在，丢弃任务`);
      return;
    }
    const leaseToken = randomUUID();
    const claimed = await this.repo.claimRun(runId, leaseToken, this.leaseMsFor(probe.settings));
    if (!claimed) {
      this.log(`run ${runId} 认领失败（已被其它 Worker 持有，或已不在 queued/running）`);
      return;
    }

    const parsed = parseRunSettings(claimed.settings);
    if (!parsed.ok) {
      await this.systemFailure(claimed, leaseToken, parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
      return;
    }

    const settings = parsed.settings;
    const budget = new BudgetTracker(settings, (claimed.startedAt ?? new Date()).getTime());
    // 恢复的 Run 必须接上已消耗的轮次，否则暂停再启动等于预算清零重来
    budget.onRoundCompleted(claimed.currentRound);
    // 已落库的 token 消耗同理：从消息累计回来，不能让重启变成免费额度
    budget.onTokensSpent(await this.repo.sumRunTokens(runId));

    this.log(`已认领 run=${claimed.id} room=${claimed.roomId} 第 ${claimed.currentRound} 轮`);
    await this.loop(claimed, leaseToken, settings, budget);
  }

  /**
   * 生成复盘。被两种队列任务复用：讨论跑到终态时自动调用，
   * 房主手动"正常结束"时由 API 派一个 summarize 任务过来。
   */
  async summarizeRun(runId: string): Promise<void> {
    const run = await this.repo.getRun(runId);
    if (!run) {
      this.log(`复盘失败：run ${runId} 不存在`);
      return;
    }
    const roles = await this.repo.getRoomRoles(run.roomId);
    const [turns, moderation] = await Promise.all([
      this.repo.getRunTranscript(runId),
      this.repo.getRunModeration(runId),
    ]);

    const provider = this.pickSummaryProvider(roles);
    const result = await buildSummary(
      {
        topic: run.topic,
        goal: run.goal,
        completionCriteria: run.completionCriteria,
        turns,
        moderation,
        roles: roles.map((role) => ({ id: role.id, name: role.name, stance: role.stance })),
      },
      provider,
      // 复盘是长文本，给它比单次发言更宽的超时
      run.settings.aiTimeoutSeconds * 2 * 1000,
    );

    await this.repo.saveSummary(runId, result.payload, result.sourceMessageIds, result.status, result.error);
    this.log(
      `run=${runId} 复盘已生成（${result.payload.mode}，${result.status}）${result.error ? `：${result.error}` : ''}`,
    );
  }

  /** 按角色顺序挑第一个能解析出模型的；都配错则返回 null，退化成摘录而不是失败。 */
  private pickSummaryProvider(roles: RoomRoleRecord[]): ModelProvider | null {
    for (const role of roles) {
      try {
        return this.registry.resolve(role.modelName);
      } catch {
        continue;
      }
    }
    return null;
  }

  private async loop(
    run: ClaimedRun,
    leaseToken: string,
    settings: RunSettings,
    budget: BudgetTracker,
  ): Promise<void> {
    let current = run;
    let emptyRounds = 0;

    for (;;) {
      // §1.4：PAUSE / TERMINATE 优先于下一轮调度，所以每轮开头重读，不信任内存里的状态
      const fresh = await this.repo.getRun(current.id);
      if (!fresh) return;
      current = fresh;

      if (current.status !== 'running') {
        await this.repo.releaseLease(current.id, leaseToken);
        this.log(`run=${current.id} 状态已是 ${current.status}，让位退出`);
        return;
      }
      // renewLease 的 where 同时要求 leaseToken 匹配且未过期，
      // 返回 false 就等价于"已不再持有有效租约"，不必再多查一次。
      // 真实模型单次调用就要几十秒，不续租的话自己会把租约熬过期。
      if (!(await this.repo.renewLease(current.id, leaseToken, this.leaseMsFor(settings)))) {
        this.log(`run=${current.id} 租约已不在手里，立即停止写入`);
        return;
      }

      const verdict = budget.check(Date.now());
      if (verdict.exhausted) {
        await this.terminate(current, leaseToken, verdict.reason, '预算耗尽');
        return;
      }

      const roles = await this.repo.getRoomRoles(current.roomId);
      if (roles.length === 0) {
        await this.terminate(current, leaseToken, 'no_available_agents', '房间内没有角色');
        return;
      }
      const states = await this.reviveRoles(
        current,
        await this.repo.ensureAgentStates(
          current.id,
          roles.map((role) => role.id),
        ),
        roles,
      );

      const selection = selectNextSpeaker(
        this.candidates(current, roles, states, settings, budget.budgetRemainingRatio(Date.now())),
      );
      await this.recordAudit(current, selection.audit);

      if (!selection.selectedRoleId) {
        emptyRounds += 1;
        // 全员被禁言或被连续发言上限挡住时，推进轮次让禁言自然到期
        if (emptyRounds > settings.defaultMuteRounds + 1) {
          await this.terminate(
            current,
            leaseToken,
            'no_available_agents',
            `连续 ${emptyRounds} 轮无人可发言`,
          );
          return;
        }
        if (!(await this.advanceRound(current, leaseToken, budget))) return;
        continue;
      }
      emptyRounds = 0;

      const role = roles.find((entry) => entry.id === selection.selectedRoleId)!;
      const outcome = await this.speak(
        current,
        role,
        states.find((s) => s.roleId === role.id)!,
        settings,
        budget,
        leaseToken,
      );
      if (outcome === 'lost') return;

      const after = await this.repo.getAgentStates(current.id);
      if (await this.isRoundComplete(current, roles, after)) {
        if (!(await this.advanceRound(current, leaseToken, budget))) return;
      }
    }
  }

  /**
   * 每轮调度前先做一次"复活"扫描：
   * - muted 且已到期 -> UNMUTE -> idle（§2.2 "到期或房主撤销"）
   * - error 且距上次失败已跨过一整轮 -> RESET -> idle（§2.2 "由房主或系统恢复"）
   *
   * 第二道是看了真实端点的行为后加的：端点会偶发返回空内容，若一次失败就永久排除，
   * 一个抖动角色能让整场讨论少一个人跑完全程。恢复刻意至少隔一轮，
   * 并用 ROLE_ERROR_CEILING 兜住真正配坏的角色，不让它无限占用调度。
   * 返回内存中修正后的视图，调用方不必再查一次库。
   */
  private async reviveRoles(
    run: ClaimedRun,
    states: AgentStateRecord[],
    roles: RoomRoleRecord[],
  ): Promise<AgentStateRecord[]> {
    const name = (roleId: string): string =>
      roles.find((role) => role.id === roleId)?.name ?? roleId;

    const out: AgentStateRecord[] = [];
    for (const state of states) {
      const unmute =
        state.state === 'muted' && state.mutedUntilRound <= run.currentRound
          ? roleTransition('muted', 'UNMUTE')
          : null;
      if (unmute?.ok) {
        await this.repo.saveAgentState(run.id, state.roleId, { state: 'idle', mutedUntilRound: 0 });
        await this.emit({
          roomId: run.roomId,
          event: { type: 'role_state', payload: { runId: run.id, roleId: state.roleId, state: 'idle' } },
        });
        this.log(`角色 ${name(state.roleId)} 禁言到期，自动解禁`);
        out.push({ ...state, state: 'idle', mutedUntilRound: 0 });
        continue;
      }

      const recoverable =
        state.state === 'error' &&
        state.errorCount < ROLE_ERROR_CEILING &&
        run.currentRound > state.lastErrorRound;
      const reset = recoverable ? roleTransition('error', 'RESET') : null;
      if (reset?.ok) {
        await this.repo.saveAgentState(run.id, state.roleId, { state: 'idle' });
        await this.emit({
          roomId: run.roomId,
          event: { type: 'role_state', payload: { runId: run.id, roleId: state.roleId, state: 'idle' } },
        });
        this.log(`角色 ${name(state.roleId)} 从 error 恢复（已失败 ${state.errorCount} 次）`);
        out.push({ ...state, state: 'idle' });
      } else {
        out.push(state);
      }
    }
    return out;
  }

  private candidates(
    run: ClaimedRun,
    roles: RoomRoleRecord[],
    states: AgentStateRecord[],
    settings: RunSettings,
    budgetRemaining: number,
  ): CandidateFeatures[] {
    const byRole = new Map(states.map((state) => [state.roleId, state]));
    return roles.map((role) => {
      const state = byRole.get(role.id);
      const lastSpoke = state?.lastSpokeRound ?? -1;
      const spokeThisRound = lastSpoke === run.currentRound;
      return {
        roleId: role.id,
        // 本轮已发过言的角色视作"忙"，由导演的硬排除挡掉，防止它把整轮吃掉
        state: spokeThisRound ? ('speaking' as const) : (state?.state ?? ('idle' as const)),
        // 落库的 consecutiveTurns 只在"上一轮确实发言过"时才仍然成立；
        // 缺这个衰减，"最多连续 2 轮"会变成"发言 2 轮后被永久排除"
        consecutiveTurns:
          lastSpoke === run.currentRound - 1 ? (state?.consecutiveTurns ?? 0) : 0,
        silenceRounds: lastSpoke < 0 ? 0 : run.currentRound - lastSpoke,
        // 没有 LLM 相关度打分时给中性值，让 silence / conflict 决定顺序
        relevance: 0.5,
        mentioned: 0,
        conflict: role.aggressiveness / 200,
        budgetRemaining,
        maxConsecutiveTurns: settings.maxConsecutiveTurns,
      };
    });
  }

  /** error / removed 的角色不算"还欠一次发言"，否则一个模型配错就能卡死整轮。 */
  private async isRoundComplete(
    run: ClaimedRun,
    roles: RoomRoleRecord[],
    states: AgentStateRecord[],
  ): Promise<boolean> {
    const byRole = new Map(states.map((state) => [state.roleId, state]));
    for (const role of roles) {
      const state = byRole.get(role.id);
      if (!state || state.state === 'removed' || state.state === 'error') continue;
      if (state.state === 'muted' && state.mutedUntilRound > run.currentRound) continue;
      if (state.lastSpokeRound !== run.currentRound) return false;
    }
    return true;
  }

  private async advanceRound(
    run: ClaimedRun,
    leaseToken: string,
    budget: BudgetTracker,
  ): Promise<boolean> {
    budget.onRoundCompleted();
    const next = run.currentRound + 1;
    const ok = await this.repo.commitRun(run.id, leaseToken, run.version, { currentRound: next });
    if (!ok) return this.reconcile(run.id, leaseToken);
    await this.emit({
      roomId: run.roomId,
      event: { type: 'run_status', payload: { runId: run.id, status: 'running', currentRound: next } },
    });
    return true;
  }

  private async speak(
    run: ClaimedRun,
    role: RoomRoleRecord,
    state: AgentStateRecord,
    settings: RunSettings,
    budget: BudgetTracker,
    leaseToken: string,
  ): Promise<SpeakOutcome> {
    const selected = roleTransition(state.state, 'SELECT', { runRunning: run.status === 'running' });
    if (!selected.ok) {
      this.log(`角色 ${role.name} 无法被选中：${selected.reason}`);
      return 'skipped';
    }
    await this.repo.saveAgentState(run.id, role.id, { state: 'thinking' });
    await this.emit({
      roomId: run.roomId,
      event: { type: 'role_state', payload: { runId: run.id, roleId: role.id, state: 'thinking' } },
    });

    let provider: ModelProvider;
    try {
      provider = this.registry.resolve(role.modelName);
    } catch (error) {
      if (error instanceof UnknownModelError) {
        await this.failRole(run, role, state, error.message);
        return 'skipped';
      }
      throw error;
    }

    const context = (await this.repo.getContext(run.id, CONTEXT_WINDOW)) as ContextTurn[];
    const attempt = await this.callModel(provider, run, role, settings, context);
    if (!attempt.ok) {
      await this.failRole(run, role, state, attempt.message);
      return 'skipped';
    }

    // 模型这几十秒里房主可能已经按下暂停（暂停会收回租约）。
    // 只在循环开头检查的话，这条结果仍会在暂停之后落地，直接违背验收 #4。
    if (!(await this.repo.renewLease(run.id, leaseToken, this.leaseMsFor(settings)))) {
      budget.onTokensSpent(attempt.tokens); // 发言丢弃，但钱已经花了，不能装作没发生
      this.log(`run=${run.id} 等待模型期间已易主或已暂停，丢弃这条已生成的发言`);
      return 'lost';
    }

    // thinking --FIRST_TOKEN--> speaking --COMPLETE_MESSAGE--> idle
    if (!roleTransition('thinking', 'FIRST_TOKEN').ok) return 'skipped';

    const created = await this.repo.appendMessage({
      roomId: run.roomId,
      runId: run.id,
      senderType: 'agent',
      roleId: role.id,
      content: attempt.text,
      status: 'completed',
      tokens: attempt.tokens,
    });
    const message = await this.repo.messageForEvent(created.id);
    if (message) await this.emit({ roomId: run.roomId, event: { type: 'message', payload: message } });
    // 钱已经花掉了：这笔消耗必须在后续转换之前入账，漏记会让 token_budget 永远打不满
    budget.onTokensSpent(attempt.tokens);

    if (!roleTransition('speaking', 'COMPLETE_MESSAGE').ok) return 'skipped';

    // 连续发言轮数：上一轮也发过言才累加，否则从 1 重新计
    const consecutive =
      state.lastSpokeRound === run.currentRound - 1 ? state.consecutiveTurns + 1 : 1;
    await this.repo.saveAgentState(run.id, role.id, {
      state: 'idle',
      consecutiveTurns: consecutive,
      lastSpokeRound: run.currentRound,
      errorCount: 0,
    });
    await this.emit({
      roomId: run.roomId,
      event: { type: 'role_state', payload: { runId: run.id, roleId: role.id, state: 'idle' } },
    });

    // 治理评估必须发生在"选下一位发言者"之前：处置写入的 muted/removed
    // 会在下一轮开头被导演读到并把该角色挡在候选集外
    await this.moderator
      .evaluate({
        run,
        role,
        state: {
          ...state,
          state: 'idle',
          consecutiveTurns: consecutive,
          lastSpokeRound: run.currentRound,
        },
        subject: {
          messageId: created.id,
          sequence: created.sequence,
          roleId: role.id,
          content: attempt.text,
        },
        settings,
      })
      // 管理员出错不能拖垮整场讨论：宁可漏一次处置，也不让 Run 卡死
      .catch((error: unknown) => this.log(`治理检测失败，已跳过：${(error as Error).message}`));

    return 'spoke';
  }

  private async callModel(
    provider: ModelProvider,
    run: ClaimedRun,
    role: RoomRoleRecord,
    settings: RunSettings,
    context: ContextTurn[],
  ): Promise<{ ok: true; text: string; tokens: number } | { ok: false; message: string }> {
    let lastMessage = '未知错误';
    // 每次尝试都自带一份完整的 aiTimeoutSeconds 预算（provider 内部用 AbortSignal.timeout）
    for (let attempt = 0; attempt <= settings.maxRetries; attempt += 1) {
      try {
        const result = await provider.speak({
          roleName: role.name,
          systemPrompt: role.systemPrompt,
          topic: run.topic,
          goal: run.goal || undefined,
          stance: role.stance || undefined,
          context,
          maxTokens: settings.maxTokensPerMessage,
          timeoutMs: settings.aiTimeoutSeconds * 1000,
        });
        return { ok: true, text: result.text, tokens: result.tokens };
      } catch (error) {
        lastMessage = error instanceof ModelCallError ? `${error.kind}: ${error.message}` : String(error);
        this.log(`角色 ${role.name} 第 ${attempt + 1} 次调用失败：${lastMessage}`);
      }
    }
    return { ok: false, message: lastMessage };
  }

  private async failRole(
    run: ClaimedRun,
    role: RoomRoleRecord,
    state: AgentStateRecord,
    message: string,
  ): Promise<void> {
    // 只有 thinking 是此刻的真实状态：SELECT 之后、FIRST_TOKEN 之前必然停在 thinking
    if (!roleTransition('thinking', 'CALL_FAILED').ok) return;
    await this.repo.saveAgentState(run.id, role.id, {
      state: 'error',
      errorCount: state.errorCount + 1,
      lastErrorRound: run.currentRound,
    });
    await this.emit({
      roomId: run.roomId,
      event: { type: 'role_state', payload: { runId: run.id, roleId: role.id, state: 'error' } },
    });
    const note = await this.repo.appendMessage({
      roomId: run.roomId,
      runId: run.id,
      senderType: 'system',
      content: `角色「${role.name}」本轮调用失败：${message}`,
      status: 'completed',
    });
    const record = await this.repo.messageForEvent(note.id);
    if (record) await this.emit({ roomId: run.roomId, event: { type: 'message', payload: record } });
    this.log(`角色 ${role.name} 进入 error：${message}`);
  }

  /** 版本冲突后重读对账，绝不覆盖新状态（§1.4）。返回 false 表示主循环该退出了。 */
  private async reconcile(runId: string, leaseToken: string): Promise<boolean> {
    const fresh = await this.repo.getRun(runId);
    if (!fresh) return false;
    if (fresh.status !== 'running') {
      await this.repo.releaseLease(runId, leaseToken);
      return false;
    }
    return fresh.leaseToken === leaseToken;
  }

  private async terminate(
    run: ClaimedRun,
    leaseToken: string,
    reason: RunTerminationReason,
    detail: string,
  ): Promise<void> {
    const transition = runTransition(run.status, 'TERMINATE');
    if (!transition.ok) {
      this.log(`run=${run.id} 无法终止：${transition.reason}`);
      return;
    }
    const endedAt = new Date();
    const ok = await this.repo.commitRun(run.id, leaseToken, run.version, {
      status: 'terminated',
      terminationReason: reason,
      endedAt,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    if (!ok) {
      this.log(`run=${run.id} 终止时版本冲突，交给重读后的下一轮处理`);
      return;
    }
    await this.emit({
      roomId: run.roomId,
      event: {
        type: 'run_status',
        payload: { runId: run.id, status: 'terminated', terminationReason: reason, endedAt },
      },
    });
    await this.repo.releaseLease(run.id, leaseToken);
    this.log(`run=${run.id} 已终止：${reason}（${detail}）`);

    // 终态即复盘时机（flows §4 完成信号）。复盘失败不能反过来让终止流程失败，
    // Run 该停还是要停，界面顶多显示"复盘未生成"。
    await this.summarizeRun(run.id).catch((error: unknown) =>
      this.log(`复盘生成失败（不影响 Run 状态）：${(error as Error).message}`),
    );
  }

  private async systemFailure(run: ClaimedRun, leaseToken: string, detail: string): Promise<void> {
    const transition = runTransition(run.status, 'SYSTEM_FAILURE');
    if (!transition.ok) {
      this.log(`run=${run.id} 无法进入 failed：${detail}`);
      return;
    }
    await this.repo.commitRun(run.id, leaseToken, run.version, {
      status: 'failed',
      leaseToken: null,
      leaseExpiresAt: null,
    });
    await this.emit({
      roomId: run.roomId,
      event: { type: 'error', payload: { message: detail, code: 'run_settings_invalid' } },
    });
    this.log(`run=${run.id} 系统故障：${detail}`);
  }

  /** 落库而不是只打日志：mvp-spec §6 要求调度评分因素可审计，复盘页要能回答"为什么是他发言"。 */
  private async recordAudit(run: ClaimedRun, audit: SelectionAudit): Promise<void> {
    try {
      await this.repo.saveScheduleAudit(run.id, run.currentRound, audit);
    } catch (error) {
      // 审计写失败不该中断讨论，但必须留下痕迹
      this.log(`调度审计写入失败：${(error as Error).message}`);
    }
  }

  private async emit(event: RoomEvent): Promise<void> {
    try {
      await this.publish(event);
    } catch (error) {
      // Pub/Sub 只是活性提示，DB 才是真相；推送失败绝不能中断讨论
      this.log(`事件推送失败（不影响数据）：${(error as Error).message}`);
    }
  }
}
