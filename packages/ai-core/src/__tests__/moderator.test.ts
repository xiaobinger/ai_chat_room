import { describe, expect, it } from 'vitest';
import type { ModeratorRule } from '@tianma/contracts';
import {
  decideLadderAction,
  detectViolations,
  evaluateRule,
  jaccard,
  keywordHits,
  tokenize,
  validatePolicyDraft,
  type DetectionInput,
  type EvidenceMessage,
} from '../moderator';

function message(id: string, content: string, sequence = Number(id)): EvidenceMessage {
  return { messageId: id, sequence, roleId: 'role-a', content };
}

function rule(overrides: Partial<ModeratorRule> & { id: string; kind: ModeratorRule['kind'] }): ModeratorRule {
  return {
    label: overrides.id,
    enabled: true,
    action: 'warn',
    safety: false,
    ...overrides,
  };
}

function input(overrides: Partial<DetectionInput> = {}): DetectionInput {
  return {
    rules: [],
    subject: message('10', '我们就远程办公的效率问题展开讨论'),
    recent: [],
    consecutiveTurns: 0,
    maxConsecutiveTurns: 2,
    repetitionThreshold: 3,
    relevance: null,
    ...overrides,
  };
}

describe('text similarity for Chinese content', () => {
  it('splits latin on word boundaries and CJK into character bigrams', () => {
    expect(tokenize('AI Agent 很智能')).toEqual(['ai', 'agent', '很智', '智能']);
    expect(tokenize('一')).toEqual(['一']);
    expect(tokenize('')).toEqual([]);
  });

  it('is case insensitive and order independent', () => {
    const a = new Set(tokenize('Remote Work 效率'));
    const b = new Set(tokenize('效率 REMOTE work'));
    expect(jaccard(a, b)).toBe(1);
  });

  it('scores identical text 1, disjoint text 0, and empty sets 0', () => {
    const s = (t: string) => new Set(tokenize(t));
    expect(jaccard(s('远程办公提高效率'), s('远程办公提高效率'))).toBe(1);
    expect(jaccard(s('远程办公提高效率'), s('quantum cryptography'))).toBe(0);
    expect(jaccard(s(''), s('任意'))).toBe(0);
  });

  it('separates paraphrase from verbatim repetition', () => {
    const s = (t: string) => new Set(tokenize(t));
    const verbatim = jaccard(s('我认为应当全面禁止远程办公'), s('我认为应当全面禁止远程办公'));
    const paraphrase = jaccard(s('我认为应当全面禁止远程办公'), s('午餐吃什么比较合适呢'));
    expect(verbatim).toBeGreaterThan(0.6);
    expect(paraphrase).toBeLessThan(0.6);
  });

  it('matches keywords case-insensitively and ignores blanks', () => {
    expect(keywordHits('这里有 Secret 内容', ['secret', '  ', '隐私'])).toEqual(['secret']);
    expect(keywordHits('正常发言', ['secret', '隐私'])).toEqual([]);
  });
});

describe('deterministic detectors (the mock-provider fallback)', () => {
  const repetition = rule({ id: 'R-02', kind: 'spam_repetition', action: 'warn', threshold: 0.6 });

  it('needs repetitionThreshold similar messages before firing', () => {
    const recent = [
      message('1', '我认为应当全面禁止远程办公'),
      message('2', '我认为应当全面禁止远程办公'),
    ];
    const subject = message('3', '我认为应当全面禁止远程办公');
    expect(evaluateRule(repetition, input({ rules: [repetition], subject, recent }))).toBeNull();

    recent.push(message('4', '我认为应当全面禁止远程办公'));
    const hit = evaluateRule(repetition, input({ rules: [repetition], subject, recent }));
    expect(hit).toMatchObject({
      ruleId: 'R-02',
      kind: 'spam_repetition',
      safety: false,
      suggestedAction: 'warn',
    });
    expect(hit?.explanation).toContain('重复阈值 3');
    expect(hit?.evidenceMessageIds).toEqual(['1', '2', '4', '3']);
  });

  it('ignores the subject itself when counting repeats', () => {
    const subject = message('9', '远程办公让协作成本上升');
    const hit = evaluateRule(repetition, input({ subject, recent: [subject], repetitionThreshold: 1 }));
    expect(hit).toBeNull();
  });

  it('falls back to the 0.6 similarity floor when a rule omits threshold', () => {
    const loose = rule({ id: 'R-02', kind: 'spam_repetition', action: 'warn' });
    const recent = [message('1', '完全一样的话'), message('2', '完全一样的话')];
    const hit = evaluateRule(
      loose,
      input({ subject: message('3', '完全一样的话'), recent, repetitionThreshold: 2 }),
    );
    expect(hit).not.toBeNull();
    expect(hit?.threshold).toBe(0.6);
  });

  it('fires turn hogging at the ceiling and scales the score', () => {
    const hogging = rule({ id: 'R-03', kind: 'turn_hogging', action: 'mute' });
    expect(evaluateRule(hogging, input({ consecutiveTurns: 1 }))).toBeNull();
    const hit = evaluateRule(hogging, input({ consecutiveTurns: 2 }));
    expect(hit).toMatchObject({ ruleId: 'R-03', suggestedAction: 'mute', threshold: 2 });
    expect(hit?.explanation).toContain('连续发言 2 轮');
    expect(evaluateRule(hogging, input({ consecutiveTurns: 4 }))?.score).toBeGreaterThan(hit!.score);
  });

  it('needs a keyword table to be configured, otherwise it abstains', () => {
    const forbidden = rule({ id: 'R-01', kind: 'forbidden_topic', action: 'kick', safety: true });
    expect(evaluateRule(forbidden, input({ subject: message('1', '涉及内幕交易的话') }))).toBeNull();

    const configured = rule({ ...forbidden, keywords: ['内幕交易', '洗钱'] });
    const hit = evaluateRule(configured, input({ subject: message('1', '涉及内幕交易的话') }));
    expect(hit).toMatchObject({ safety: true, suggestedAction: 'kick' });
    expect(hit?.explanation).toContain('内幕交易');
  });

  it('treats personal_attack and custom as keyword rules too', () => {
    const attack = rule({ id: 'R-04', kind: 'personal_attack', action: 'warn', keywords: ['蠢货', '白痴'] });
    expect(evaluateRule(attack, input({ subject: message('1', '你真是个蠢货') }))).not.toBeNull();
    const custom = rule({ id: 'R-05', kind: 'custom', action: 'remind', keywords: ['广告'] });
    expect(evaluateRule(custom, input({ subject: message('1', '純聊天沒有广告') }))).not.toBeNull();
    expect(evaluateRule(custom, input({ subject: message('1', '今天天气不错') }))).toBeNull();
  });
});

describe('off_topic is one signal among several, never a gate', () => {
  const offTopic = rule({ id: 'R-06', kind: 'off_topic', action: 'warn', threshold: 0.5 });

  it('abstains when the model gave no relevance score', () => {
    expect(evaluateRule(offTopic, input({ relevance: null }))).toBeNull();
  });

  it('fires only below the relevance floor', () => {
    expect(evaluateRule(offTopic, input({ relevance: 0.8 }))).toBeNull();
    const hit = evaluateRule(offTopic, input({ relevance: 0.2 }));
    expect(hit).toMatchObject({ ruleId: 'R-06', threshold: 0.5 });
    expect(hit?.explanation).toContain('20%');
  });
});

describe('detectViolations', () => {
  it('skips disabled rules', () => {
    const result = detectViolations(
      input({
        rules: [rule({ id: 'R-03', kind: 'turn_hogging', action: 'mute', enabled: false })],
        consecutiveTurns: 5,
      }),
    );
    expect(result.hits).toEqual([]);
    expect(result.primary).toBeNull();
  });

  it('orders hits by severity with a deterministic tie-break', () => {
    const rules = [
      rule({ id: 'R-b', kind: 'forbidden_topic', action: 'warn', keywords: ['禁忌'] }),
      rule({ id: 'R-a', kind: 'forbidden_topic', action: 'warn', keywords: ['禁忌'] }),
      rule({ id: 'R-c', kind: 'turn_hogging', action: 'mute' }),
    ];
    const result = detectViolations(
      input({ rules, subject: message('1', '这是禁忌'), recent: [], consecutiveTurns: 2 }),
    );
    expect(result.hits.map((h) => h.ruleId)).toEqual(['R-c', 'R-a', 'R-b']);
    expect(result.primary?.ruleId).toBe('R-c');
    // R-a 与 R-b 分数相同，只能靠 ruleId 字典序稳定排序
    expect(result.hits[1]!.score).toBe(result.hits[2]!.score);
  });
});

describe('penalty ladder (permissions §4)', () => {
  const ladder = ['remind', 'warn', 'mute', 'kick'] as const;
  const warnHit = {
    ruleId: 'R-02',
    kind: 'spam_repetition' as const,
    label: '重复',
    score: 0.8,
    threshold: 0.6,
    evidenceMessageIds: ['1'],
    explanation: 'x',
    safety: false,
    suggestedAction: 'warn' as const,
  };
  const base = {
    ladder: [...ladder],
    hit: warnHit,
    currentRound: 7,
    defaultMuteRounds: 3,
    hasPriorWarnOrMute: false,
  };

  it('advances one rung per offence and mutes for a bounded number of rounds', () => {
    expect(decideLadderAction({ ...base, level: 0 })).toEqual({
      action: 'remind',
      nextLevel: 1,
      mutedUntilRound: null,
      downgraded: false,
      note: '处罚阶梯第 1 档（4 档）',
    });
    expect(decideLadderAction({ ...base, level: 1 })).toMatchObject({ action: 'warn', nextLevel: 2 });
    expect(decideLadderAction({ ...base, level: 2 })).toMatchObject({ action: 'mute', nextLevel: 3 });
    expect(decideLadderAction({ ...base, level: 2 }).mutedUntilRound).toBe(7 + 3);
  });

  it('refuses a first-response kick without prior warn or mute', () => {
    // level 3 maps to kick, but there is no warn/mute on record
    const decision = decideLadderAction({ ...base, level: 3, hasPriorWarnOrMute: false });
    expect(decision).toMatchObject({ action: 'mute', downgraded: true });
    expect(decision.note).toContain('降档');
  });

  it('allows the kick once a warn or mute exists, or for safety rules', () => {
    expect(decideLadderAction({ ...base, level: 3, hasPriorWarnOrMute: true })).toMatchObject({
      action: 'kick',
      downgraded: false,
    });
    expect(
      decideLadderAction({ ...base, level: 3, hasPriorWarnOrMute: false, hit: { ...warnHit, safety: true } }),
    ).toMatchObject({ action: 'kick' });
  });

  it('never runs off the end of the ladder', () => {
    expect(decideLadderAction({ ...base, level: 9, hasPriorWarnOrMute: true })).toMatchObject({
      action: 'kick',
      nextLevel: 4,
    });
  });

  it('honours a custom short ladder', () => {
    expect(decideLadderAction({ ...base, ladder: ['warn', 'kick'], level: 0 })).toMatchObject({
      action: 'warn',
      nextLevel: 1,
    });
  });
});

describe('validatePolicyDraft (flows §3 失败路径)', () => {
  const offTopic = rule({ id: 'R-01', kind: 'off_topic', action: 'remind', threshold: 0.6 });
  const validLadder = ['remind', 'warn', 'mute', 'kick'];

  it('放行一份正常策略', () => {
    expect(
      validatePolicyDraft([offTopic, rule({ id: 'R-05', kind: 'forbidden_topic', action: 'kick', keywords: ['内幕交易'] })], validLadder),
    ).toEqual({ ok: true });
  });

  it('规则为空时拒绝发布', () => {
    const result = validatePolicyDraft([], validLadder);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toMatchObject({ path: 'rules' });
  });

  it('需要触发条件的规则缺关键词时拒绝，并指明是哪一条', () => {
    const result = validatePolicyDraft([rule({ id: 'R-05', kind: 'forbidden_topic', action: 'kick' })], validLadder);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.path).toBe('rules[0].keywords');
      expect(result.issues[0]!.message).toContain('forbidden_topic');
    }
  });

  it('偏题规则必须显式给阈值，不允许沿用缺省值发布', () => {
    const result = validatePolicyDraft([rule({ id: 'R-01', kind: 'off_topic', action: 'remind' })], validLadder);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.path).toBe('rules[0].threshold');
  });

  it('规则不得携带撤销动作（管理员不能自我撤销）', () => {
    const result = validatePolicyDraft(
      [rule({ id: 'R-09', kind: 'forbidden_topic', action: 'revoke', keywords: ['x'] })],
      validLadder,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.path).toBe('rules[0].action');
  });

  it('阶梯乱序、重复或含未知档位都被拒绝', () => {
    for (const ladder of [
      ['kick', 'warn'],
      ['warn', 'warn'],
      ['remind', 'exile'],
      [],
    ]) {
      expect(validatePolicyDraft([offTopic], ladder).ok).toBe(false);
    }
    // 合法的非连续子序列（跳过禁言直接 提醒→警告→移出）仍然放行
    expect(validatePolicyDraft([offTopic], ['remind', 'warn', 'kick']).ok).toBe(true);
  });

  it('一次列出全部冲突项，而不是撞到第一个就返回', () => {
    const result = validatePolicyDraft(
      [
        rule({ id: 'R-x', kind: 'forbidden_topic', action: 'warn' }),
        rule({ id: 'R-x', kind: 'off_topic', action: 'remind' }),
        rule({ id: 'R-z', kind: 'custom', action: 'revoke' }),
      ],
      ['kick', 'warn'],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThanOrEqual(5);
      expect(result.issues.map((issue) => issue.path)).toEqual([
        'rules[0].keywords',
        'rules[1].id',
        'rules[1].threshold',
        'rules[2].action',
        'rules[2].keywords',
        'ladder[1]',
      ]);
    }
  });
});
