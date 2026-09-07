import { describe, expect, it } from 'vitest';
import type { SummaryDraft } from '@tianma/contracts';
import {
  attachCitations,
  buildSummary,
  campsFromRoles,
  extractiveSummary,
  governanceItems,
  mergeDraft,
  type DraftInput,
  type GovernanceRecord,
  type TranscriptMessage,
} from '../summarizer';
import { ModelCallError, type ModelProvider } from '../model-provider';

const msg = (id: string, sequence: number, speaker: string, content: string): TranscriptMessage => ({
  id,
  sequence,
  senderType: 'agent',
  roleId: `role-${speaker}`,
  speaker,
  content,
  createdAt: new Date(0),
});

const TURNS: TranscriptMessage[] = [
  msg('m1', 1, '甲', '远程办公降低通勤成本，是效率净收益。'),
  msg('m2', 2, '乙', '协作损耗与隐性知识传承被系统性低估，这条更短。'),
  msg('m3', 3, '甲', '补充：人才池扩大带来的收益可以量化。'),
];

const EVENTS: GovernanceRecord[] = [
  {
    id: 'e1',
    action: 'mute',
    reason: '连续偏题两次',
    matchedRule: 'R-01',
    policyVersion: 2,
    targetRoleId: 'role-乙',
    durationRounds: 3,
    evidenceMessageIds: ['m2'],
  },
];

function draftInput(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    topic: '远程办公是不是伪命题',
    goal: '产出可执行结论',
    completionCriteria: '形成三条共识',
    turns: TURNS,
    moderation: EVENTS,
    roles: [
      { id: 'role-甲', name: '甲', stance: '支持远程' },
      { id: 'role-乙', name: '乙', stance: '' },
    ],
    ...overrides,
  };
}

function providerReturning(draft: SummaryDraft | null): ModelProvider {
  return {
    name: 'stub',
    async speak() {
      return { text: '', tokens: 0, tokensMeasured: true };
    },
    async scoreRelevance() {
      return null;
    },
    async summarize() {
      return draft;
    },
  };
}

describe('引用映射', () => {
  it('映射不到真实消息的条目被丢弃，模型无法用编造的证据支撑结论', () => {
    const bySequence = new Map<number, string>([[1, 'm1'], [2, 'm2']]);
    const items = attachCitations(
      [
        { text: '站得住的结论', sourceSequences: [1, 2] },
        { text: '引用了不存在的消息', sourceSequences: [99] },
        { text: '一个引用都没有', sourceSequences: [] },
      ],
      bySequence,
    );
    expect(items).toEqual([{ text: '站得住的结论', sourceMessageIds: ['m1', 'm2'] }]);
  });

  it('重复引用同一序号只留一条', () => {
    const bySequence = new Map<number, string>([[1, 'm1'], [2, 'm2']]);
    expect(attachCitations([{ text: 'x', sourceSequences: [1, 1, 2] }], bySequence)).toEqual([
      { text: 'x', sourceMessageIds: ['m1', 'm2'] },
    ]);
  });
});

describe('阵营归派', () => {
  it('只认输入里出现过的发言人姓名，不跟着模型幻觉造角色', () => {
    const speakers = new Map<string, string>([['甲', 'role-甲']]);
    const camps = campsFromRoles(
      [
        { id: 'role-甲', name: '甲', stance: '支持远程' },
        { id: 'role-乙', name: '乙', stance: '协作损耗更大' },
      ],
      speakers,
      [
        { name: '效率派', speakers: ['甲', '根本不存在的人'], position: '净收益' },
        { name: '幻觉派', speakers: ['也不存在'], position: '' },
      ],
    );
    // 甲已被模型阵营收走，不再用 stance 兜底重复登记一次；乙没有被收走，才补出兜底阵营
    expect(camps).toEqual([
      { name: '效率派', roleIds: ['role-甲'], position: '净收益' },
      { name: '立场：乙', roleIds: ['role-乙'], position: '协作损耗更大' },
    ]);
  });

  it('没有模型阵营时，用角色表里真实的 stance 兜底', () => {
    const camps = campsFromRoles([
      { id: 'r1', name: '甲', stance: '支持远程' },
      { id: 'r2', name: '乙', stance: '  ' },
    ]);
    expect(camps).toEqual([{ name: '立场：甲', roleIds: ['r1'], position: '支持远程' }]);
  });
});

describe('治理段落始终由确定性数据构成', () => {
  it('事件文本带规则、策略版本与时长，引用来自证据消息 id', () => {
    const items = governanceItems(EVENTS);
    expect(items[0]!.text).toContain('R-01');
    expect(items[0]!.text).toContain('v2');
    expect(items[0]!.text).toContain('时长 3 轮');
    expect(items[0]!.sourceMessageIds).toEqual(['m2']);
  });

  it('摘录模式下共识/分歧留空而不是编一段', () => {
    const payload = extractiveSummary(draftInput());
    expect(payload.mode).toBe('extractive');
    expect(payload.consensus).toEqual([]);
    expect(payload.disputes).toEqual([]);
    expect(payload.unresolved).toEqual([]);
    expect(payload.keyPoints.length).toBeGreaterThan(0);
    // 每条观点都必须能定位到原消息
    for (const item of payload.keyPoints) {
      expect(TURNS.map((turn) => turn.id)).toContain(item.sourceMessageIds[0]);
      expect(item.text).toMatch(/^#\d+【/);
    }
    expect(payload.moderation).toHaveLength(1);
  });

  it('没有治理事件时治理段落为空，不虚构处置', () => {
    expect(extractiveSummary(draftInput({ moderation: [] })).moderation).toEqual([]);
  });
});

describe('buildSummary 的降级路径', () => {
  it('模型可用时走 model 模式并保留完成度', async () => {
    const result = await buildSummary(
      draftInput(),
      providerReturning({
        completionScore: 72,
        keyPoints: [{ text: '成本口径要先统一', sourceSequences: [1] }],
        consensus: [{ text: '远程并非完全无效', sourceSequences: [1, 3] }],
        disputes: [{ text: '隐性知识传承', sourceSequences: [2] }],
        unresolved: [],
        followUps: [{ text: '补一组离职率数据', sourceSequences: [2] }],
        camps: [{ name: '效率派', speakers: ['甲'], position: '净收益' }],
      }),
      30_000,
    );

    expect(result.status).toBe('ready');
    expect(result.error).toBeNull();
    expect(result.payload.mode).toBe('model');
    expect(result.payload.completionScore).toBe(72);
    expect(result.payload.consensus[0]).toEqual({
      text: '远程并非完全无效',
      sourceMessageIds: ['m1', 'm3'],
    });
    expect(result.payload.camps[0]).toEqual({ name: '效率派', roleIds: ['role-甲'], position: '净收益' });
    // 治理段落不由模型叙述
    expect(result.payload.moderation).toHaveLength(1);
    expect(result.sourceMessageIds.sort()).toEqual(['m1', 'm2', 'm3']);
  });

  it('模型整体不可用时降级为摘录，并说明原因', async () => {
    const result = await buildSummary(draftInput(), providerReturning(null), 30_000);
    expect(result.payload.mode).toBe('extractive');
    expect(result.status).toBe('ready');
    expect(result.error).toContain('已改用摘录');
    expect(result.payload.keyPoints.length).toBeGreaterThan(0);
  });

  it('模型全部引用都是编的时同样降级，而不是端出一段无据结论', async () => {
    const result = await buildSummary(
      draftInput(),
      providerReturning({ keyPoints: [{ text: '听起来很合理', sourceSequences: [4242] }] }),
      30_000,
    );
    expect(result.payload.mode).toBe('extractive');
    expect(result.error).toContain('没有一条能对应到真实消息');
  });

  it('抛错的模型不会让复盘整体失败', async () => {
    const broken: ModelProvider = {
      name: 'broken',
      async speak() {
        return { text: '', tokens: 0, tokensMeasured: true };
      },
      async scoreRelevance() {
        return null;
      },
      async summarize() {
        throw new ModelCallError('transport', '端点不可达');
      },
    };
    const result = await buildSummary(draftInput(), broken, 30_000);
    expect(result.status).toBe('ready');
    expect(result.payload.mode).toBe('extractive');
    expect(result.error).toContain('端点不可达');
  });

  it('没有 provider 时也产出可用的摘录复盘', async () => {
    const result = await buildSummary(draftInput(), null, 30_000);
    expect(result.payload.mode).toBe('extractive');
    expect(result.error).toContain('没有可用的模型');
  });

  it('空讨论直接标 failed，不编一份复盘', async () => {
    const result = await buildSummary(draftInput({ turns: [], moderation: [] }), providerReturning(null), 1000);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('run_has_no_messages');
    expect(result.sourceMessageIds).toEqual([]);
  });

  it('摘录只保留最有信息量的若干条，且输出仍按时间顺序', async () => {
    const turns = Array.from({ length: 9 }, (_unused, index) =>
      // 序号越大说得越长，最后的 m9 最长；m1 最短
      msg(`m${index + 1}`, index + 1, '甲', 'x'.repeat(10 + index * 40)),
    );
    const result = await buildSummary(draftInput({ turns }), providerReturning(null), 1000);

    const kept = result.payload.keyPoints.map((item) => item.sourceMessageIds[0]);
    expect(kept).toHaveLength(6);
    // 最短的三条被淘汰，入选者按序号升序而不是按长度
    expect(kept).toEqual(['m4', 'm5', 'm6', 'm7', 'm8', 'm9']);
  });
});

describe('mergeDraft', () => {
  it('模型缺字段时对应段落为空，而不是崩溃', () => {
    const payload = mergeDraft(draftInput(), {});
    expect(payload.mode).toBe('model');
    expect(payload.keyPoints).toEqual([]);
    expect(payload.camps.map((camp) => camp.name)).toEqual(['立场：甲']);
    expect(payload.moderation).toHaveLength(1);
  });
});
