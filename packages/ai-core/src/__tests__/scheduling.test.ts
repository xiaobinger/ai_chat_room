import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN_SETTINGS, type RunSettings } from '@tianma/contracts';
import { BudgetTracker } from '../budget';
import { defaultRunSettings, parseRunSettings, validateRunStart } from '../config';
import {
  clamp01,
  DIRECTOR_WEIGHTS,
  hardExclusionReason,
  scoreCandidate,
  selectNextSpeaker,
  type CandidateFeatures,
} from '../director';

const settings: RunSettings = { ...DEFAULT_RUN_SETTINGS };

describe('run settings (mvp-spec §5)', () => {
  it('applies every spec default', () => {
    expect(parseRunSettings({})).toEqual({ ok: true, settings: DEFAULT_RUN_SETTINGS });
    expect(settings.maxRounds).toBe(20);
    expect(settings.maxConsecutiveTurns).toBe(2);
    expect(settings.maxTokensPerMessage).toBe(1500);
    expect(settings.tokenBudget).toBe(12_000);
    expect(settings.timeLimitMinutes).toBe(30);
    expect(settings.repetitionThreshold).toBe(3);
    expect(settings.aiTimeoutSeconds).toBe(60);
    expect(settings.maxRetries).toBe(1);
    expect(settings.defaultMuteRounds).toBe(3);
  });

  it('hard-caps maxRounds at 100', () => {
    expect(parseRunSettings({ maxRounds: 100 }).ok).toBe(true);
    const over = parseRunSettings({ maxRounds: 101 });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.issues[0]).toMatchObject({ path: 'maxRounds' });
  });

  it('reports the offending path instead of a bare error', () => {
    const result = parseRunSettings({ tokenBudget: -5, timeLimitMinutes: 'soon' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.path).sort()).toEqual([
        'timeLimitMinutes',
        'tokenBudget',
      ]);
    }
  });

  it('returns a defensive copy of the defaults', () => {
    const a = defaultRunSettings();
    a.maxRounds = 1;
    expect(defaultRunSettings().maxRounds).toBe(20);
    expect(DEFAULT_RUN_SETTINGS.maxRounds).toBe(20);
  });
});

describe('validateRunStart (state-machines.md §1.2)', () => {
  it('refuses to start with nothing to say', () => {
    expect(validateRunStart({ mode: 'free', speakableAgentCount: 0 })).toEqual({
      ok: false,
      reason: 'no_speakable_agent',
    });
  });

  it('requires a topic in structured mode, and checks agents first', () => {
    expect(validateRunStart({ mode: 'structured', topic: '  ', speakableAgentCount: 0 })).toEqual({
      ok: false,
      reason: 'no_speakable_agent',
    });
    expect(validateRunStart({ mode: 'structured', topic: '  远程办公  ', speakableAgentCount: 1 })).toEqual({
      ok: true,
    });
    expect(validateRunStart({ mode: 'free', speakableAgentCount: 1 })).toEqual({ ok: true });
  });
});

describe('BudgetTracker', () => {
  const started = 1_700_000_000_000;
  const at = (offset: number) => started + offset;
  const tracker = () => new BudgetTracker(settings, started);

  it('reports no pressure when nothing is spent', () => {
    expect(tracker().check(at(0))).toEqual({ exhausted: false });
    expect(tracker().budgetRemainingRatio(at(0))).toBe(1);
  });

  it('exhausts on the round limit', () => {
    const b = tracker();
    b.onRoundCompleted(settings.maxRounds - 1);
    expect(b.check(at(0))).toEqual({ exhausted: false });
    b.onRoundCompleted();
    expect(b.check(at(0))).toEqual({ exhausted: true, reason: 'round_limit' });
  });

  it('exhausts on the token budget', () => {
    const b = tracker();
    b.onTokensSpent(11_999);
    expect(b.check(at(0))).toEqual({ exhausted: false });
    b.onTokensSpent(1);
    expect(b.check(at(0))).toEqual({ exhausted: true, reason: 'token_budget' });
  });

  it('exhausts on the wall clock', () => {
    const b = tracker();
    expect(b.check(at(settings.timeLimitMinutes * 60_000 - 1))).toEqual({ exhausted: false });
    expect(b.check(at(settings.timeLimitMinutes * 60_000))).toEqual({
      exhausted: true,
      reason: 'time_limit',
    });
  });

  it('prefers round over token over time when all three are blown', () => {
    const b = tracker();
    b.onRoundCompleted(settings.maxRounds);
    b.onTokensSpent(settings.tokenBudget);
    expect(b.check(at(99 * 60_000))).toMatchObject({ reason: 'round_limit' });
    const byTokens = tracker();
    byTokens.onTokensSpent(settings.tokenBudget);
    expect(byTokens.check(at(99 * 60_000))).toMatchObject({ reason: 'token_budget' });
  });

  it('clamps garbage metering instead of throwing', () => {
    const b = tracker();
    b.onTokensSpent(-500);
    b.onTokensSpent(10.9);
    expect(b.tokens).toBe(10);
    expect(b.budgetRemainingRatio(at(0))).toBeCloseTo(1 - 10 / settings.tokenBudget, 6);
  });

  it('takes the tightest of the three dimensions', () => {
    const b = tracker();
    b.onTokensSpent(settings.tokenBudget);
    expect(b.budgetRemainingRatio(at(0))).toBe(0);
  });

  it('never lets elapsed time go negative on clock skew', () => {
    expect(tracker().elapsedMs(started - 10_000)).toBe(0);
  });
});

function candidate(overrides: Partial<CandidateFeatures> = {}): CandidateFeatures {
  return {
    roleId: 'role-a',
    state: 'idle',
    consecutiveTurns: 0,
    silenceRounds: 1,
    relevance: 0.5,
    mentioned: 0,
    conflict: 0,
    budgetRemaining: 1,
    maxConsecutiveTurns: 2,
    ...overrides,
  };
}

describe('director (mvp-spec §4)', () => {
  it('weights sum to exactly 1', () => {
    const sum = Object.values(DIRECTOR_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('clamps nonsense out of the feature vector', () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(9)).toBe(1);
    const scored = scoreCandidate(candidate({ relevance: 5, mentioned: -2 }));
    expect(scored.factors).toMatchObject({ relevance: 1, mentioned: 0 });
  });

  it('scores a neutral idle candidate deterministically', () => {
    const scored = scoreCandidate(candidate());
    const expected =
      0.5 * DIRECTOR_WEIGHTS.relevance +
      0 * DIRECTOR_WEIGHTS.mentioned +
      0 * DIRECTOR_WEIGHTS.conflict +
      0.2 * DIRECTOR_WEIGHTS.silence +
      1 * DIRECTOR_WEIGHTS.budget;
    expect(scored.total).toBeCloseTo(expected, 10);
    expect(scored.excluded).toBe(false);
  });

  it('gives a never-spoken role a neutral silence score, not zero', () => {
    expect(scoreCandidate(candidate({ silenceRounds: 0 })).factors.silence).toBe(0.5);
    expect(scoreCandidate(candidate({ silenceRounds: 3 })).factors.silence).toBeCloseTo(0.6, 10);
    expect(scoreCandidate(candidate({ silenceRounds: 99 })).factors.silence).toBe(1);
  });

  it('hard-excludes governance states before anything else', () => {
    expect(hardExclusionReason(candidate({ state: 'muted' }))).toBe('state_muted');
    expect(hardExclusionReason(candidate({ state: 'removed' }))).toBe('state_removed');
    expect(hardExclusionReason(candidate({ state: 'error' }))).toBe('state_error');
    expect(hardExclusionReason(candidate({ state: 'thinking' }))).toBe('state_thinking');
    expect(hardExclusionReason(candidate({ state: 'speaking' }))).toBe('state_speaking');
    expect(hardExclusionReason(candidate({ state: 'idle' }))).toBeNull();
  });

  it('excludes a role that already hit the consecutive-turn ceiling', () => {
    expect(hardExclusionReason(candidate({ consecutiveTurns: 1 }))).toBeNull();
    expect(hardExclusionReason(candidate({ consecutiveTurns: 2 }))).toBe('consecutive_turns_limit(2)');
  });

  it('picks the highest scoring eligible role and keeps the audit', () => {
    const result = selectNextSpeaker([
      candidate({ roleId: 'role-a', relevance: 0.2 }),
      candidate({ roleId: 'role-b', relevance: 0.9 }),
      candidate({ roleId: 'role-c', relevance: 1, state: 'muted' }),
    ]);
    expect(result.selectedRoleId).toBe('role-b');
    expect(result.ranking.map((r) => r.roleId)).toEqual(['role-c', 'role-b', 'role-a']);
    expect(result.audit.excluded).toEqual([{ roleId: 'role-c', reason: 'state_muted' }]);
    expect(result.audit.selectedRoleId).toBe('role-b');
    expect(result.audit.selectionReason).toBe('highest_score');
    expect(result.audit.weights).toBe(DIRECTOR_WEIGHTS);
    expect(result.audit.ranking).toHaveLength(3);
  });

  it('never routes to a muted role even with a perfect score', () => {
    const result = selectNextSpeaker([
      candidate({ roleId: 'role-loud', relevance: 1, state: 'muted' }),
      candidate({ roleId: 'role-quiet', relevance: 0.1 }),
    ]);
    expect(result.selectedRoleId).toBe('role-quiet');
  });

  it('breaks ties by lexicographic roleId so the same input picks the same speaker', () => {
    const pool = [
      candidate({ roleId: 'role-zulu', relevance: 0.4, silenceRounds: 2 }),
      candidate({ roleId: 'role-alpha', relevance: 0.4, silenceRounds: 2 }),
      candidate({ roleId: 'role-mike', relevance: 0.4, silenceRounds: 2 }),
    ];
    const first = selectNextSpeaker(pool);
    expect(first.selectedRoleId).toBe('role-alpha');
    // 输入顺序不能影响结果
    const shuffled = selectNextSpeaker([pool[2]!, pool[0]!, pool[1]!]);
    expect(shuffled.selectedRoleId).toBe('role-alpha');
    expect(shuffled.audit.ranking.map((r) => r.roleId)).toEqual(
      first.audit.ranking.map((r) => r.roleId),
    );
  });

  it('reports why nothing could be scheduled', () => {
    expect(selectNextSpeaker([])).toMatchObject({
      selectedRoleId: null,
      audit: { selectionReason: 'no_candidates' },
    });
    expect(
      selectNextSpeaker([candidate({ roleId: 'role-a', state: 'muted' })]),
    ).toMatchObject({
      selectedRoleId: null,
      audit: { selectionReason: 'all_candidates_excluded' },
    });
  });
});
