import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Brain, ChevronRight, MapPin, RefreshCw } from 'lucide-react';
import type { Message, SummaryItem, SummaryPayload } from '@tianma/contracts';
import { api, describeError } from '../lib/api';
import { Notice, Shell, Top } from '../components/Shell';
import { relativeTime, terminationLabel } from '../lib/format';

/** 服务端在 run detail 里额外 include 了 role；contracts 的 Message 不带这个字段 */
type RunMessage = Message & { role?: { id: string; name: string; color: string | null } | null };

interface RunDetail {
  id: string;
  status: string;
  topic: string;
  goal: string;
  currentRound: number;
  settings: { maxRounds: number; tokenBudget: number };
  terminationReason: string | null;
  createdAt: string;
  endedAt: string | null;
  messages: RunMessage[];
}

interface SummaryResponse {
  status: string;
  error: string | null;
  createdAt?: string;
  payload: SummaryPayload | null;
}

const SECTIONS: { key: keyof SummaryPayload; title: string; kind: 'list' | 'danger' | 'plain' }[] = [
  { key: 'consensus', title: '形成的共识', kind: 'list' },
  { key: 'disputes', title: '主要争论', kind: 'plain' },
  { key: 'unresolved', title: '仍未解决的分歧', kind: 'danger' },
  { key: 'keyPoints', title: '关键观点', kind: 'plain' },
  { key: 'followUps', title: '后续问题', kind: 'plain' },
];

export default function DiscussionReview() {
  const { id = '', runId = '' } = useParams();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [runDetail, summaryResponse] = await Promise.all([
        api<RunDetail>('GET', `/rooms/${id}/runs/${runId}`),
        api<SummaryResponse>('GET', `/rooms/${id}/runs/${runId}/summary`),
      ]);
      setRun(runDetail);
      setSummary(summaryResponse);
    } catch (error) {
      setProblem(describeError(error));
    }
  }, [id, runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byId = useMemo(() => new Map((run?.messages ?? []).map((message) => [message.id, message])), [run]);

  const regenerate = async () => {
    try {
      await api('POST', `/rooms/${id}/runs/${runId}/summary`, {});
      // 归纳在 Worker 侧进行，稍后重取一次即可看到结果
      setTimeout(() => void load(), 3000);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  if (problem) {
    return (
      <Shell>
        <Top title="讨论复盘" sub="载入失败" />
        <section className="content">
          <Notice kind="error">{problem}</Notice>
        </section>
      </Shell>
    );
  }

  if (!run || !summary) {
    return (
      <Shell>
        <Top title="讨论复盘" sub="正在载入…" />
        <section className="content">
          <Notice kind="info">读取 Run 与摘要…</Notice>
        </section>
      </Shell>
    );
  }

  const payload = summary.payload;
  const camps = payload?.camps ?? [];

  return (
    <Shell>
      <Top
        title="讨论复盘"
        sub={`Run ${run.id.slice(0, 8)} · ${run.status === 'completed' ? '已完成' : `终止：${terminationLabel(run.terminationReason ?? run.status)}`} · ${run.currentRound} 轮`}
        action={
          <Link className="primary" to={`/rooms/${id}`}>
            返回聊天室
          </Link>
        }
      />
      <section className="content review">
        <div className="score">
          <small>讨论完成度</small>
          <strong>{payload?.completionScore ?? '—'}</strong>
          <span>/ 100</span>
          <p>
            {run.messages.filter((message) => message.senderType === 'agent').length} 条 AI 发言 ·{' '}
            {run.messages.reduce((sum, message) => sum + (message.tokens ?? 0), 0).toLocaleString('en-US')} tokens /{' '}
            {run.settings.tokenBudget.toLocaleString('en-US')}
          </p>
          {payload?.mode && (
            <p className="hint">
              {payload.mode === 'model' ? '由模型归纳' : '摘录模式（模型未完成归纳）'}
            </p>
          )}
          {summary.error && <Notice kind="error">{summary.error}</Notice>}
          <button className="secondary" onClick={() => void regenerate()}>
            <RefreshCw />
            重新生成
          </button>
        </div>

        {summary.status === 'pending' && (
          <Notice kind="info">复盘还在生成中。讨论终态后由 Worker 归纳，稍后刷新即可。</Notice>
        )}

        {payload && (
          <>
            {SECTIONS.map((section) => {
              const items = payload[section.key] as SummaryItem[] | undefined;
              if (!items || items.length === 0) return null;
              return (
                <div className={`reviewcard ${section.kind === 'danger' ? 'danger' : ''}`} key={section.key}>
                  <h2>{section.title}</h2>
                  {section.kind === 'list' ? (
                    <ol>
                      {items.map((item, index) => (
                        <li key={`${section.key}-${index}`}>
                          <span>{item.text}</span>
                          <Citations
                            item={item}
                            open={open}
                            byId={byId}
                            onToggle={(key) => setOpen(open === key ? null : key)}
                            roomId={id}
                            sectionKey={section.key}
                            index={index}
                          />
                        </li>
                      ))}
                    </ol>
                  ) : (
                    items.map((item, index) => (
                      <p key={`${section.key}-${index}`}>
                        <span>{item.text}</span>
                        <Citations
                          item={item}
                          open={open}
                          byId={byId}
                          onToggle={(key) => setOpen(open === key ? null : key)}
                          roomId={id}
                          sectionKey={section.key}
                          index={index}
                        />
                      </p>
                    ))
                  )}
                </div>
              );
            })}

            {camps.length > 0 && (
              <div className="reviewcard">
                <h2>阵营与立场</h2>
                {camps.map((camp) => (
                  <p key={camp.name}>
                    <b>{camp.name}：</b>
                    {camp.position || '—'}
                  </p>
                ))}
              </div>
            )}

            {(payload.moderation?.length ?? 0) > 0 && (
              <div className="reviewcard">
                <h2>
                  <Brain /> 治理动作
                </h2>
                {payload.moderation!.map((item, index) => (
                  <p key={`mod-${index}`}>
                    <span>{item.text}</span>
                    <Citations
                      item={item}
                      open={open}
                      byId={byId}
                      onToggle={(key) => setOpen(open === key ? null : key)}
                      roomId={id}
                      sectionKey="moderation"
                      index={index}
                    />
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </Shell>
  );
}

/**
 * 验收 #7 的落点：每条结论都能展开看到它引用的原消息，而不是只给一句概括。
 * 摘要是服务端把模型给的序号映射回真实消息 id 后落库的，所以这里的查表
 * 一旦查不到就说明数据有问题 —— 明说，而不是静默少渲染一条。
 */
function Citations({
  item,
  open,
  byId,
  onToggle,
  roomId,
  sectionKey,
  index,
}: {
  item: SummaryItem;
  open: string | null;
  byId: Map<string, RunMessage>;
  onToggle(key: string): void;
  roomId: string;
  sectionKey: string;
  index: number;
}) {
  const key = `${sectionKey}-${index}`;
  if (item.sourceMessageIds.length === 0) return null;

  return (
    <span className="cites">
      <button onClick={() => onToggle(key)}>
        <MapPin />
        {item.sourceMessageIds.length} 条原消息
      </button>
      <Link to={`/rooms/${roomId}?highlight=${item.sourceMessageIds[0]}`} title="在聊天室中定位">
        <ChevronRight />
      </Link>
      {open === key && (
        <div className="cite-list">
          {item.sourceMessageIds.map((messageId) => {
            const source = byId.get(messageId);
            return (
              <p key={messageId}>
                {source ? (
                  <>
                    <b>
                      #{source.sequence} {source.role?.name ?? source.senderType}
                    </b>
                    <span>{source.content}</span>
                    <small>{relativeTime(source.createdAt)}</small>
                  </>
                ) : (
                  <b>引用的消息 {messageId.slice(0, 8)} 不在本 Run 内</b>
                )}
              </p>
            );
          })}
        </div>
      )}
    </span>
  );
}
