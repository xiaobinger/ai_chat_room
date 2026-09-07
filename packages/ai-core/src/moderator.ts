import type {
  ModerationAction,
  ModeratorRule,
  PenaltyLadder,
} from '@tianma/contracts';

export interface EvidenceMessage {
  messageId: string;
  sequence: number;
  roleId: string | null;
  content: string;
}

export interface DetectionInput {
  rules: ModeratorRule[];
  /** 待判定的那条消息（通常是刚落库的 completed 发言） */
  subject: EvidenceMessage;
  /** 同 Run 内最近的已完成的发言，用于重复检测 */
  recent: EvidenceMessage[];
  consecutiveTurns: number;
  maxConsecutiveTurns: number;
  repetitionThreshold: number;
  /**
   * LLM 给出的主题相关度 0..1。null 表示这一路不可用（端点超时或未返回）。
   * 偏题判定是全案最不确定的一环，因此它只是六类信号之一，不是必要条件。
   */
  relevance: number | null;
}

export interface RuleHit {
  ruleId: string;
  kind: ModeratorRule['kind'];
  label: string;
  /** 触发强度 0..1，用于多条命中时排序 */
  score: number;
  /** 生效阈值，随证据一并落库，使判定说明可复核 */
  threshold: number;
  evidenceMessageIds: string[];
  explanation: string;
  safety: boolean;
  suggestedAction: ModerationAction;
}

export interface DetectionResult {
  hits: RuleHit[];
  primary: RuleHit | null;
}

const DEFAULT_SIMILARITY_FLOOR = 0.6;
const DEFAULT_OFF_TOPIC_THRESHOLD = 0.5;
const SIMILARITY_WINDOW = 12;

/** CJK 统一表意文字基本区 + 扩展 A + 兼容表意文字。 */
const CJK_SEGMENT = /[㐀-䶿一-鿿豈-﫿]+/g;

/**
 * 中文没有空格，按空白切词会让整条消息变成单个 token，Jaccard 恒为 0 或 1。
 * 因此拉丁/数字按词切，CJK 连续段按字符二元组切。
 */
export function tokenize(text: string): string[] {
  const lowered = text.toLowerCase();
  const tokens: string[] = [];
  for (const match of lowered.matchAll(/[a-z0-9_]+/g)) tokens.push(match[0]);
  CJK_SEGMENT.lastIndex = 0;
  for (const match of lowered.matchAll(CJK_SEGMENT)) {
    const segment = match[0];
    if (segment.length === 1) tokens.push(segment);
    for (let i = 0; i + 1 < segment.length; i++) tokens.push(segment.slice(i, i + 2));
  }
  return tokens;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/** 大小写无关的子串命中；返回命中的词表元素。 */
export function keywordHits(text: string, keywords: readonly string[]): string[] {
  const haystack = text.toLowerCase();
  return keywords.filter((keyword) => {
    const needle = keyword.toLowerCase().trim();
    return needle.length > 0 && haystack.includes(needle);
  });
}

function hit(
  rule: ModeratorRule,
  partial: Omit<RuleHit, 'ruleId' | 'kind' | 'label' | 'safety' | 'suggestedAction'>,
): RuleHit {
  return {
    ruleId: rule.id,
    kind: rule.kind,
    label: rule.label,
    safety: rule.safety,
    suggestedAction: rule.action,
    ...partial,
  };
}

/**
 * 单条规则评估。返回 null 表示未命中或该路信号不可用（绝不猜测）。
 */
export function evaluateRule(
  rule: ModeratorRule,
  input: DetectionInput,
): RuleHit | null {
  const subject = input.subject;

  switch (rule.kind) {
    case 'spam_repetition': {
      const floor = rule.threshold ?? DEFAULT_SIMILARITY_FLOOR;
      const subjectTokens = new Set(tokenize(subject.content));
      const window = input.recent
        .filter((m) => m.messageId !== subject.messageId)
        .slice(-SIMILARITY_WINDOW);
      const matches = window.filter((m) => jaccard(subjectTokens, new Set(tokenize(m.content))) >= floor);
      if (matches.length < input.repetitionThreshold) return null;
      return hit(rule, {
        score: Math.min(1, matches.length / input.repetitionThreshold),
        threshold: floor,
        evidenceMessageIds: [...matches.map((m) => m.messageId), subject.messageId],
        explanation: `与最近 ${window.length} 条发言中 ${matches.length} 条的相似度 ≥ ${(floor * 100).toFixed(0)}%，达到重复阈值 ${input.repetitionThreshold}`,
      });
    }

    case 'turn_hogging': {
      if (input.consecutiveTurns < input.maxConsecutiveTurns) return null;
      // 阈值字段对这类规则表示"容忍倍数"，缺省 2 倍时才判定为严重霸占
      const limit = Math.max(1, Math.round(input.maxConsecutiveTurns * (rule.threshold ?? 1)));
      if (input.consecutiveTurns < limit) return null;
      return hit(rule, {
        score: Math.min(1, input.consecutiveTurns / (limit * 2)),
        threshold: limit,
        evidenceMessageIds: [subject.messageId],
        explanation: `连续发言 ${input.consecutiveTurns} 轮，超过上限 ${limit}`,
      });
    }

    case 'forbidden_topic':
    case 'personal_attack':
    case 'custom': {
      const keywords = rule.keywords ?? [];
      if (keywords.length === 0) return null;
      const matched = keywordHits(subject.content, keywords);
      if (matched.length === 0) return null;
      return hit(rule, {
        score: Math.min(1, matched.length / 3),
        threshold: rule.threshold ?? 1,
        evidenceMessageIds: [subject.messageId],
        explanation: `命中 ${matched.length} 个违禁词：${matched.join('、')}`,
      });
    }

    case 'off_topic': {
      if (input.relevance === null) return null;
      const threshold = rule.threshold ?? DEFAULT_OFF_TOPIC_THRESHOLD;
      const offScore = 1 - input.relevance;
      if (offScore < threshold) return null;
      return hit(rule, {
        score: Math.min(1, offScore),
        threshold,
        evidenceMessageIds: [subject.messageId],
        explanation: `模型判定主题相关度 ${(input.relevance * 100).toFixed(0)}%，低于 ${(threshold * 100).toFixed(0)}% 门槛`,
      });
    }
  }
}

/** 命中按 score 降序，平局按 ruleId 字典序，保证可复现。 */
export function detectViolations(input: DetectionInput): DetectionResult {
  const hits: RuleHit[] = [];
  for (const rule of input.rules) {
    if (!rule.enabled) continue;
    const result = evaluateRule(rule, input);
    if (result) hits.push(result);
  }
  hits.sort((a, b) => b.score - a.score || (a.ruleId < b.ruleId ? -1 : 1));
  return { hits, primary: hits[0] ?? null };
}

export type LadderAction = 'remind' | 'warn' | 'mute' | 'kick';

export interface LadderDecision {
  action: LadderAction;
  /** 写回 PenaltyState.level 的新游标 */
  nextLevel: number;
  mutedUntilRound: number | null;
  /** 因 permissions §4 前置条件不足而从 kick 降档 */
  downgraded: boolean;
  note: string;
}

export interface LadderInput {
  ladder: PenaltyLadder;
  /** 当前 PenaltyState.level，0 表示从未被治理 */
  level: number;
  hit: RuleHit;
  currentRound: number;
  defaultMuteRounds: number;
  hasPriorWarnOrMute: boolean;
}

/**
 * 阶梯游标单调推进；超出阶梯长度后停在最后一档（对重复违规持续移出）。
 * §4：移出前必须已有警告或禁言记录，安全紧急规则除外。
 */
export function decideLadderAction(input: LadderInput): LadderDecision {
  const idx = Math.min(Math.max(0, input.level), input.ladder.length - 1);
  const requested = input.ladder[idx];
  let action: LadderAction = requested;
  let downgraded = false;
  let note = `处罚阶梯第 ${idx + 1} 档（${input.ladder.length} 档）`;

  if (requested === 'kick' && !input.hit.safety && !input.hasPriorWarnOrMute) {
    const fallback = input.ladder[Math.max(0, idx - 1)];
    action = fallback === 'kick' ? 'mute' : fallback;
    downgraded = true;
    note = `移出前缺少警告或禁言记录，降档为 ${action}`;
  }

  return {
    action,
    nextLevel: Math.min(input.ladder.length, idx + 1),
    // §4：禁言必须是限时的，解禁条件写进轮次而不是靠人工记得撤销
    mutedUntilRound: action === 'mute' ? input.currentRound + input.defaultMuteRounds : null,
    downgraded,
    note,
  };
}

/** 需要关键词才有触发条件的规则类型。 */
const KEYWORD_KINDS: ReadonlySet<ModeratorRule['kind']> = new Set([
  'forbidden_topic',
  'personal_attack',
  'custom',
]);

/** 标准严重度序列；自定义阶梯必须是它的严格递增子序列。 */
const SEVERITY_ORDER = ['remind', 'warn', 'mute', 'kick'] as const;

export interface PolicyIssue {
  path: string;
  message: string;
}

export type PolicyValidation = { ok: true } | { ok: false; issues: PolicyIssue[] };

/**
 * 策略发布前的语义校验。
 *
 * contracts 的 zod 只能保证形状合法；flows §3 要求的四条失败路径
 * （缺触发条件、处罚无上限、管理员管理自身、越权）都是语义约束，只能在这里挡。
 * 全部收集完再返回，让界面能一次列出所有冲突项。
 */
export function validatePolicyDraft(
  rules: readonly ModeratorRule[],
  ladder: readonly string[],
): PolicyValidation {
  const issues: PolicyIssue[] = [];

  if (rules.length === 0) {
    issues.push({ path: 'rules', message: '至少需要一条规则' });
  }

  const seen = new Set<string>();
  rules.forEach((rule, index) => {
    const at = `rules[${index}]`;
    if (seen.has(rule.id)) {
      issues.push({ path: `${at}.id`, message: `规则 id "${rule.id}" 重复` });
    }
    seen.add(rule.id);

    // 撤销是房主的权限，不是规则可以授予的动作 —— 否则等于让管理员自我撤销
    if (rule.action === 'revoke') {
      issues.push({ path: `${at}.action`, message: '规则不得以"撤销"作为处罚动作' });
    }
    if (KEYWORD_KINDS.has(rule.kind) && (rule.keywords?.length ?? 0) === 0) {
      issues.push({ path: `${at}.keywords`, message: `${rule.kind} 规则必须给出至少一个触发关键词` });
    }
    if (rule.kind === 'off_topic' && rule.threshold === undefined) {
      issues.push({ path: `${at}.threshold`, message: '偏题规则必须显式设定相关度阈值，不能沿用缺省值' });
    }
  });

  if (ladder.length === 0) {
    issues.push({ path: 'ladder', message: '处罚阶梯不能为空' });
  }
  // 严格递增子序列：一次覆盖重复档位、乱序与未知档位
  let lastSeverity = -1;
  ladder.forEach((action, index) => {
    const severity = (SEVERITY_ORDER as readonly string[]).indexOf(action);
    if (severity === -1) {
      issues.push({ path: `ladder[${index}]`, message: `未知处罚档位 "${action}"（可用：${SEVERITY_ORDER.join(' / ')}）` });
      return;
    }
    if (severity <= lastSeverity) {
      issues.push({
        path: `ladder[${index}]`,
        message: `处罚阶梯必须按严重度递增，"${action}" 不能排在更重的档位之后`,
      });
      return;
    }
    lastSeverity = severity;
  });

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
