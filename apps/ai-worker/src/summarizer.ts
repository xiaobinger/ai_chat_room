import type {
  RawSummaryItem,
  SummaryCamp,
  SummaryDraft,
  SummaryItem,
  SummaryPayload,
} from '@tianma/contracts';
import type { ModelProvider } from './model-provider';

/** 参与复盘的一条消息。sequence 是给模型看的引用键，id 是落库用的真实引用。 */
export interface TranscriptMessage {
  id: string;
  sequence: number;
  senderType: string;
  roleId: string | null;
  speaker: string;
  content: string;
  createdAt: Date;
}

export interface GovernanceRecord {
  id: string;
  action: string;
  reason: string;
  matchedRule: string | null;
  policyVersion: number | null;
  targetRoleId: string | null;
  durationRounds: number | null;
  evidenceMessageIds: string[];
}

export interface RoleStance {
  id: string;
  name: string;
  stance: string;
}

export interface DraftInput {
  topic: string;
  goal: string;
  completionCriteria: string;
  turns: TranscriptMessage[];
  moderation: GovernanceRecord[];
  roles: RoleStance[];
}

export interface SummaryResult {
  payload: SummaryPayload;
  status: 'ready' | 'failed';
  error: string | null;
  sourceMessageIds: string[];
}

const MAX_KEY_POINTS = 6;

/** 摘录模式下"有分量"的发言：越长的表述通常越具体。 */
function substantive(turns: TranscriptMessage[]): TranscriptMessage[] {
  return [...turns]
    .sort((a, b) => b.content.length - a.content.length || a.sequence - b.sequence)
    .slice(0, MAX_KEY_POINTS)
    .sort((a, b) => a.sequence - b.sequence);
}

/** 治理段落永远是确定性的：它直接来自已落库的事件，不依赖模型质量。 */
export function governanceItems(events: GovernanceRecord[]): SummaryItem[] {
  return events.map((event) => {
    const rule = event.matchedRule ? `规则 ${event.matchedRule}` : '未署名规则';
    const version = event.policyVersion === null ? '' : `（策略 v${event.policyVersion}）`;
    const duration = event.durationRounds === null ? '' : `，时长 ${event.durationRounds} 轮`;
    return {
      text: `治理动作 ${event.action}${version}：${rule}${duration}。${event.reason}`,
      sourceMessageIds: event.evidenceMessageIds,
    };
  });
}

/**
 * 把模型的序号引用换成真实消息 id。
 *
 * 映射不上的条目直接丢弃 —— 这是验收 #7 的可追溯性由构造保证的地方：
 * 模型没法引用一条不存在的消息，也就没法用编造的证据支撑结论。
 */
export function attachCitations(
  items: RawSummaryItem[] | undefined,
  bySequence: ReadonlyMap<number, string>,
): SummaryItem[] {
  if (!items) return [];
  const out: SummaryItem[] = [];
  for (const item of items) {
    const ids = item.sourceSequences
      .map((sequence) => bySequence.get(sequence))
      .filter((id): id is string => Boolean(id));
    if (ids.length === 0) continue;
    out.push({ text: item.text, sourceMessageIds: [...new Set(ids)] });
  }
  return out;
}

/** 阵营从角色的真实 stance 字段构造，而不是让模型凭印象归派。 */
export function campsFromRoles(
  roles: RoleStance[],
  speakers?: ReadonlyMap<string, string>,
  modelCamps: SummaryDraft['camps'] = [],
): SummaryCamp[] {
  const byName = new Map(speakers ?? []);
  const merged = new Map<string, SummaryCamp>();

  for (const camp of modelCamps) {
    const roleIds = camp.speakers
      .map((name) => byName.get(name))
      .filter((id): id is string => Boolean(id));
    if (roleIds.length === 0) continue;
    merged.set(camp.name, { name: camp.name, roleIds, position: camp.position });
  }

  for (const role of roles) {
    if (!role.stance.trim()) continue;
    const existing = [...merged.values()].find((camp) => camp.roleIds.includes(role.id));
    if (existing) continue;
    merged.set(`立场：${role.name}`, {
      name: `立场：${role.name}`,
      roleIds: [role.id],
      position: role.stance,
    });
  }

  return [...merged.values()];
}

/**
 * 纯摘录复盘：一条模型调用都不依赖。
 *
 * 观点与阵营来自真实消息与真实角色立场；共识 / 分歧 / 未解决 / 后续
 * 需要语义判断，宁可留空让界面标注"未生成"，也不编一段看着像结论的话。
 */
export function extractiveSummary(input: DraftInput): SummaryPayload {
  return {
    mode: 'extractive',
    keyPoints: substantive(input.turns).map((turn) => ({
      text: `#${turn.sequence}【${turn.speaker}】${turn.content}`,
      sourceMessageIds: [turn.id],
    })),
    camps: campsFromRoles(input.roles),
    disputes: [],
    consensus: [],
    unresolved: [],
    moderation: governanceItems(input.moderation),
    followUps: [],
  };
}

export function mergeDraft(input: DraftInput, draft: SummaryDraft): SummaryPayload {
  const bySequence = new Map(input.turns.map((turn) => [turn.sequence, turn.id]));
  const speakers = new Map(input.turns.map((turn) => [turn.speaker, turn.roleId ?? '']));
  for (const [name, id] of speakers) if (!id) speakers.delete(name);

  return {
    mode: 'model',
    completionScore: draft.completionScore ?? undefined,
    keyPoints: attachCitations(draft.keyPoints, bySequence),
    camps: campsFromRoles(input.roles, speakers, draft.camps),
    disputes: attachCitations(draft.disputes, bySequence),
    consensus: attachCitations(draft.consensus, bySequence),
    unresolved: attachCitations(draft.unresolved, bySequence),
    // 治理段落不由模型叙述，模型若"总结"出一条不存在的处置就会被看见
    moderation: governanceItems(input.moderation),
    followUps: attachCitations(draft.followUps, bySequence),
  };
}

/**
 * 生成一次复盘。
 *
 * 模型可用就用模型归纳；不可用（端点故障、输出不合契约、引用编造）就整体降级为摘录，
 * 而不是抛错或留空 —— 验收 #7 要的是"每条结论能定位到原消息"，
 * 摘录同样满足，只是文字的概括性弱一些。降级原因写进 error 供界面标注。
 */
export async function buildSummary(
  input: DraftInput,
  provider: ModelProvider | null,
  timeoutMs: number,
): Promise<SummaryResult> {
  if (input.turns.length === 0) {
    return {
      payload: { ...extractiveSummary(input), mode: 'extractive' },
      status: 'failed',
      error: 'run_has_no_messages',
      sourceMessageIds: [],
    };
  }

  let payload: SummaryPayload | null = null;
  let error: string | null = null;

  if (provider) {
    try {
      const draft = await provider.summarize({
        topic: input.topic,
        goal: input.goal,
        completionCriteria: input.completionCriteria,
        turns: input.turns.map((turn) => ({
          sequence: turn.sequence,
          speaker: turn.speaker,
          content: turn.content,
        })),
        timeoutMs,
      });
      if (draft) {
        const merged = mergeDraft(input, draft);
        // 全都映射不上说明模型在编造引用，这种"总结"比没有更糟
        const cited =
          merged.keyPoints.length + merged.disputes.length + merged.consensus.length + merged.unresolved.length;
        if (cited > 0) payload = merged;
        else error = '模型返回的结论没有一条能对应到真实消息，已改用摘录';
      } else {
        error = '模型未能产出合规的复盘结构，已改用摘录';
      }
    } catch (cause) {
      error = `复盘调用失败，已改用摘录：${(cause as Error).message}`;
    }
  } else {
    error = '没有可用的模型来完成语义归纳，已改用摘录';
  }

  const final = payload ?? extractiveSummary(input);
  const sourceMessageIds = new Set<string>(input.turns.map((turn) => turn.id));
  for (const item of [
    ...final.keyPoints,
    ...final.disputes,
    ...final.consensus,
    ...final.unresolved,
    ...final.followUps,
  ]) {
    for (const id of item.sourceMessageIds) sourceMessageIds.add(id);
  }

  return { payload: final, status: 'ready', error, sourceMessageIds: [...sourceMessageIds] };
}
