import type { RoleRunState } from '@tianma/contracts';

/** 权重和恰为 1，使 total 落在 [0,1]，可直接当置信度展示。 */
export const DIRECTOR_WEIGHTS = {
  relevance: 0.3,
  mentioned: 0.25,
  conflict: 0.2,
  silence: 0.15,
  budget: 0.1,
} as const;

export type DirectorFactor = keyof typeof DIRECTOR_WEIGHTS;

export interface CandidateFeatures {
  roleId: string;
  state: RoleRunState;
  /** 本 Run 内已连续发言轮数，用于霸占检测。 */
  consecutiveTurns: number;
  /** 距上次发言已过去的轮数。 */
  silenceRounds: number;
  /** 与当前主题/最近上下文的相关度 0..1（可由 LLM 或关键词给出）。 */
  relevance: number;
  /** 最近消息中被点名的强度 0..1。 */
  mentioned: number;
  /** 与场上既有观点的分歧强度 0..1。 */
  conflict: number;
  /** Run 级剩余预算比例 0..1，由 BudgetTracker 提供。 */
  budgetRemaining: number;
  maxConsecutiveTurns: number;
}

export interface ScoredCandidate {
  roleId: string;
  total: number;
  factors: Record<DirectorFactor, number>;
  excluded: boolean;
  exclusionReason: string | null;
}

export interface SelectionAudit {
  at: number;
  weights: typeof DIRECTOR_WEIGHTS;
  candidateCount: number;
  excluded: { roleId: string; reason: string }[];
  ranking: { roleId: string; total: number; factors: Record<DirectorFactor, number> }[];
  selectedRoleId: string | null;
  selectionReason: string | null;
}

export interface SelectionResult {
  selectedRoleId: string | null;
  ranking: ScoredCandidate[];
  audit: SelectionAudit;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * 硬性排除，顺序即优先级：
 * 治理状态（muted/removed/error）→ 其余非 idle 态 → 连续发言上限。
 * 被排除的角色不进入候选集（mvp-spec §4：禁言角色不出现在下一发言者候选集中）。
 */
export function hardExclusionReason(
  candidate: Pick<CandidateFeatures, 'state' | 'consecutiveTurns' | 'maxConsecutiveTurns'>,
): string | null {
  const { state } = candidate;
  if (state === 'muted' || state === 'removed' || state === 'error') {
    return `state_${state}`;
  }
  if (state !== 'idle') {
    return `state_${state}`;
  }
  if (candidate.consecutiveTurns >= candidate.maxConsecutiveTurns) {
    return `consecutive_turns_limit(${candidate.consecutiveTurns})`;
  }
  return null;
}

/**
 * silence 因子：长期未发言者按 5 轮封顶线性提升；
 * 从未发言（silenceRounds === 0）给 0.5 中性分，避免首轮全 0 导致纯字典序决定开场。
 */
function silenceFactor(silenceRounds: number): number {
  return silenceRounds > 0 ? clamp01(silenceRounds / 5) : 0.5;
}

export function scoreCandidate(candidate: CandidateFeatures): ScoredCandidate {
  const factors: Record<DirectorFactor, number> = {
    relevance: clamp01(candidate.relevance),
    mentioned: clamp01(candidate.mentioned),
    conflict: clamp01(candidate.conflict),
    silence: silenceFactor(candidate.silenceRounds),
    // Run 级指标，对同一次决策的所有候选相同：影响 total 量级以反映预算压力，不改变排序。
    budget: clamp01(candidate.budgetRemaining),
  };
  const total = (Object.keys(DIRECTOR_WEIGHTS) as DirectorFactor[]).reduce(
    (sum, key) => sum + factors[key] * DIRECTOR_WEIGHTS[key],
    0,
  );
  const exclusionReason = hardExclusionReason(candidate);
  return {
    roleId: candidate.roleId,
    total,
    factors,
    excluded: exclusionReason !== null,
    exclusionReason,
  };
}

/**
 * 平局按 roleId 字典序（升序）打破 —— 相同输入必须产生相同发言人，
 * 否则治理与复盘都无法复现。
 */
function compareScored(a: ScoredCandidate, b: ScoredCandidate): number {
  return b.total - a.total || (a.roleId < b.roleId ? -1 : 1);
}

export function selectNextSpeaker(candidates: CandidateFeatures[]): SelectionResult {
  const scored = candidates.map(scoreCandidate);
  const ranking = [...scored].sort(compareScored);
  const eligible = ranking.filter((entry) => !entry.excluded);
  const selected = eligible[0] ?? null;

  const audit: SelectionAudit = {
    at: Date.now(),
    weights: DIRECTOR_WEIGHTS,
    candidateCount: candidates.length,
    excluded: scored
      .filter((entry) => entry.excluded)
      .map((entry) => ({ roleId: entry.roleId, reason: entry.exclusionReason ?? 'unknown' })),
    ranking: ranking.map(({ roleId, total, factors }) => ({ roleId, total, factors })),
    selectedRoleId: selected?.roleId ?? null,
    selectionReason: selected
      ? 'highest_score'
      : candidates.length === 0
        ? 'no_candidates'
        : 'all_candidates_excluded',
  };

  return { selectedRoleId: audit.selectedRoleId, ranking, audit };
}
