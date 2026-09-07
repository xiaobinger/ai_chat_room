import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Shield } from 'lucide-react';
import type { ModerationAction, ModeratorRule, PenaltyLadder } from '@tianma/contracts';
import { api, describeError } from '../lib/api';
import { Notice, Shell, Top } from '../components/Shell';
import { actionLabel } from '../lib/format';

interface Policy extends Record<string, unknown> {
  version: number;
  rules: ModeratorRule[];
  ladder: PenaltyLadder;
  publishedAt: string;
  createdBy: string;
}

const NEEDS_KEYWORDS = new Set(['forbidden_topic', 'personal_attack', 'custom']);
const NEEDS_THRESHOLD = new Set(['off_topic', 'spam_repetition']);
const ACTIONS: ModerationAction[] = ['remind', 'warn', 'mute', 'kick'];
const LADDER_ALL = ['remind', 'warn', 'mute', 'kick'] as const;

export default function ModeratorRules() {
  const { id = '' } = useParams();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [history, setHistory] = useState<Array<{ version: number; publishedAt: string; ruleCount: number }>>([]);
  const [rules, setRules] = useState<ModeratorRule[]>([]);
  const [ladder, setLadder] = useState<string[]>([...LADDER_ALL]);
  const [problem, setProblem] = useState<string | null>(null);
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState(false);

  const load = async () => {
    try {
      const room = await api<{ isOwner: boolean }>('GET', `/rooms/${id}`);
      setOwner(room.isOwner);
      try {
        const current = await api<Policy>('GET', `/rooms/${id}/policy`);
        setPolicy(current);
        setRules(current.rules);
        setLadder([...current.ladder]);
      } catch {
        setPolicy(null);
        setRules([]);
      }
      if (room.isOwner) setHistory(await api('GET', `/rooms/${id}/policies`) as typeof history);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const patch = (index: number, changes: Partial<ModeratorRule>) =>
    setRules((current) => current.map((rule, at) => (at === index ? { ...rule, ...changes } : rule)));

  const byPath = useMemo(() => new Map(issues.map((issue) => [issue.path, issue.message])), [issues]);

  const publish = async () => {
    setBusy(true);
    setIssues([]);
    setProblem(null);
    try {
      const created = await api<Policy>('POST', `/rooms/${id}/policy`, { rules, ladder });
      setPolicy(created);
      setRules(created.rules);
      await load();
    } catch (error) {
      const described = describeError(error);
      if (described === 'policy_invalid') setIssues((error as { issueList: typeof issues }).issueList);
      else setProblem(described);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <Top
        title="AI 管理员规则"
        sub={policy ? `守序者 · 当前规则版本 v${policy.version}` : '尚未发布规则'}
        action={
          <Link className="secondary" to={`/rooms/${id}`}>
            返回聊天室
          </Link>
        }
      />
      <section className="content rules">
        {!owner && <Notice kind="info">你不是房主，只能查看当前生效的规则。</Notice>}
        {problem && <Notice kind="error">{problem}</Notice>}

        <div className="formcard">
          <span className="eyebrow">治理原则</span>
          <h2>处罚必须有依据，也必须可撤销</h2>

          {rules.length === 0 && <Notice kind="info">还没有规则。房主可以在创建向导里发布默认策略，或在下方添加。</Notice>}

          {rules.map((rule, index) => (
            <div className="rule" key={rule.id}>
              <input
                type="checkbox"
                checked={rule.enabled}
                disabled={!owner}
                onChange={(event) => patch(index, { enabled: event.target.checked })}
              />
              <span>
                <b>
                  {rule.id} · {rule.label}
                </b>
                <small>{ruleDescription(rule)}</small>
                {owner && NEEDS_KEYWORDS.has(rule.kind) && (
                  <input
                    value={(rule.keywords ?? []).join('、')}
                    placeholder="触发关键词，用、分隔"
                    onChange={(event) =>
                      patch(index, {
                        keywords: event.target.value
                          .split(/[、,，\s]+/)
                          .map((word) => word.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                )}
                {owner && NEEDS_THRESHOLD.has(rule.kind) && (
                  <label className="inline-field">
                    阈值 {Math.round((rule.threshold ?? 0) * 100)}%
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round((rule.threshold ?? 0) * 100)}
                      onChange={(event) => patch(index, { threshold: Number(event.target.value) / 100 })}
                    />
                  </label>
                )}
                {byPath.get(`rules[${index}].keywords`) && (
                  <em className="field-error">{byPath.get(`rules[${index}].keywords`)}</em>
                )}
                {byPath.get(`rules[${index}].threshold`) && (
                  <em className="field-error">{byPath.get(`rules[${index}].threshold`)}</em>
                )}
              </span>
              {owner && (
                <select
                  value={rule.action}
                  onChange={(event) => patch(index, { action: event.target.value as ModerationAction })}
                >
                  {ACTIONS.map((action) => (
                    <option key={action} value={action}>
                      {actionLabel(action)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}

          <h3>处罚阶梯</h3>
          <div className="ladder">
            {LADDER_ALL.map((rung, index) => {
              const active = ladder.includes(rung);
              return (
                <span key={rung} className={active ? 'on' : 'off'}>
                  {owner ? (
                    <label className="inline-field">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={(event) =>
                          setLadder((current) =>
                            event.target.checked
                              ? LADDER_ALL.filter((entry) => current.includes(entry) || entry === rung)
                              : current.filter((entry) => entry !== rung),
                          )
                        }
                      />
                      {index + 1} {actionLabel(rung)}
                    </label>
                  ) : (
                    <>{index + 1} {actionLabel(rung)}</>
                  )}
                  {index < LADDER_ALL.length - 1 && <i />}
                </span>
              );
            })}
          </div>
          {byPath.get('ladder[1]') && <em className="field-error">{byPath.get('ladder[1]')}</em>}

          {owner && (
            <div className="actions">
              <p className="hint">发布会产生 v{(policy?.version ?? 0) + 1}；旧版本永不修改，历史治理事件仍按其当时版本可追溯。</p>
              <button className="primary" onClick={() => void publish()} disabled={busy || rules.length === 0}>
                <Shield />
                {busy ? '发布中…' : '发布新规则版本'}
              </button>
            </div>
          )}
        </div>

        {history.length > 0 && (
          <div className="formcard">
            <span className="eyebrow">HISTORY</span>
            <h2>规则版本历史</h2>
            <div className="summary">
              {history.map((entry) => (
                <p key={entry.version}>
                  <b>v{entry.version}</b>
                  <span>
                    {entry.ruleCount} 条规则 · {new Date(entry.publishedAt).toLocaleString('zh-CN')}
                    {policy?.version === entry.version ? ' · 当前生效' : ''}
                  </span>
                </p>
              ))}
            </div>
          </div>
        )}
      </section>
    </Shell>
  );
}

function ruleDescription(rule: ModeratorRule): string {
  switch (rule.kind) {
    case 'off_topic':
      return `主题相关度低于 ${Math.round((1 - (rule.threshold ?? 0.6)) * 100)}% 时按「${actionLabel(rule.action)}」处置`;
    case 'turn_hogging':
      return '单个角色连续发言达到上限时移交发言权';
    case 'personal_attack':
      return `命中攻击性措辞时「${actionLabel(rule.action)}」${rule.safety ? '（安全紧急规则，可跳过前置警告）' : ''}`;
    case 'spam_repetition':
      return `与近期发言相似度达到 ${Math.round((rule.threshold ?? 0.6) * 100)}% 即视为刷屏`;
    case 'forbidden_topic':
      return `命中禁区关键词即「${actionLabel(rule.action)}」`;
    default:
      return rule.label;
  }
}
