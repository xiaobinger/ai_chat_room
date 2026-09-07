import type { RunSettings, RunTerminationReason } from '@tianma/contracts';

/** 预算只产出这三个原因；cost_budget 在 MVP 无定价模型，不参与判定。 */
export type BudgetTerminationReason = Extract<
  RunTerminationReason,
  'round_limit' | 'token_budget' | 'time_limit'
>;

export type BudgetVerdict =
  | { exhausted: false }
  | { exhausted: true; reason: BudgetTerminationReason };

const MINUTE_MS = 60_000;

/**
 * Token / 轮次 / 时间三维预算。纯计数器，不含 IO：
 * 由 Worker 在每次模型调用后喂入真实消耗，DB 是唯一持久化载体。
 */
export class BudgetTracker {
  rounds = 0;
  tokens = 0;

  constructor(
    private readonly settings: RunSettings,
    readonly startedAtMs: number = Date.now(),
  ) {}

  /** 负数与小数都是上游 bug 的症状，就地夹取而非抛错，避免整轮讨论因计量问题中断。 */
  onTokensSpent(tokens: number): void {
    this.tokens += Math.max(0, Math.floor(tokens));
  }

  onRoundCompleted(count = 1): void {
    this.rounds += Math.max(0, Math.floor(count));
  }

  elapsedMs(now: number): number {
    return Math.max(0, now - this.startedAtMs);
  }

  /**
   * 剩余比例取三维中最紧的那一维，供前端预算条与导演的 budget 因子共用。
   * 夹在 [0,1]，耗尽时为 0。
   */
  budgetRemainingRatio(now: number): number {
    const byRounds = 1 - this.rounds / this.settings.maxRounds;
    const byTokens = 1 - this.tokens / this.settings.tokenBudget;
    const byTime = 1 - this.elapsedMs(now) / (this.settings.timeLimitMinutes * MINUTE_MS);
    return Math.max(0, Math.min(1, Math.min(byRounds, byTokens, byTime)));
  }

  /**
   * 判定顺序 round → token → time 是刻意的：
   * 轮次超限是最确定的信号，时间最容易被时钟漂移干扰，放最后。
   */
  check(now: number = Date.now()): BudgetVerdict {
    if (this.rounds >= this.settings.maxRounds) {
      return { exhausted: true, reason: 'round_limit' };
    }
    if (this.tokens >= this.settings.tokenBudget) {
      return { exhausted: true, reason: 'token_budget' };
    }
    if (this.elapsedMs(now) >= this.settings.timeLimitMinutes * MINUTE_MS) {
      return { exhausted: true, reason: 'time_limit' };
    }
    return { exhausted: false };
  }

  snapshot(now: number = Date.now()) {
    return {
      rounds: this.rounds,
      maxRounds: this.settings.maxRounds,
      tokens: this.tokens,
      tokenBudget: this.settings.tokenBudget,
      elapsedMs: this.elapsedMs(now),
      timeLimitMinutes: this.settings.timeLimitMinutes,
      remainingRatio: this.budgetRemainingRatio(now),
    };
  }
}
