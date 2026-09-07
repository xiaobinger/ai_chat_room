import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ChevronRight, Gavel, Plus, Sparkles } from 'lucide-react';
import { DEFAULT_RUN_SETTINGS, type AgentProfile, type RoleType } from '@tianma/contracts';
import { api, describeError } from '../lib/api';
import { Notice, Shell, Top } from '../components/Shell';

const LABELS = ['基础信息', '讨论模式', '添加角色', '管理规则', '启动确认'];

/** 勾选角色时一并设定的临时属性（mvp-spec §3.2：不覆盖全局模板） */
interface Pick {
  profile: AgentProfile;
  stance: string;
  aggressiveness: number;
  priority: number;
  type: RoleType;
}

/**
 * 向导第 4 步默认发布的规则集。
 *
 * 刻意不含 R-02 霸占发言：导演的硬排除本来就在「连续发言 >= maxConsecutiveTurns」时
 * 把角色挡在候选集外，治理层用同一个阈值再判一次，等于把正常调度当成违规处罚 ——
 * 3 个角色 + 默认上限 2 时每个角色每两轮被记一次，阶梯很快升到禁言。
 * 检测能力仍在 ai-core；房主把 threshold 调到 1 以下即可让处罚早于调度排除发生。
 */
const DEFAULT_RULES = [
  { id: 'R-01', kind: 'off_topic', label: '偏离主题', enabled: true, threshold: 0.6, action: 'remind', safety: false },
  {
    id: 'R-03',
    kind: 'personal_attack',
    label: '攻击与骚扰',
    enabled: true,
    action: 'warn',
    safety: true,
    keywords: ['蠢货', '白痴', '垃圾话', '滚出去', '无可救药'],
  },
  { id: 'R-04', kind: 'spam_repetition', label: '重复灌水', enabled: true, threshold: 0.6, action: 'warn', safety: false },
  {
    id: 'R-05',
    kind: 'forbidden_topic',
    label: '禁区话题',
    enabled: true,
    action: 'kick',
    safety: true,
    keywords: ['内幕交易', '洗钱', '代开发票', '绕过监管'],
  },
];

export default function RoomWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'structured' | 'free'>('structured');
  const [topic, setTopic] = useState('');
  const [goal, setGoal] = useState('');
  const [completionCriteria, setCompletionCriteria] = useState('');
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [moderatorEnabled, setModeratorEnabled] = useState(true);
  const [maxRounds, setMaxRounds] = useState(DEFAULT_RUN_SETTINGS.maxRounds);
  const [tokenBudget, setTokenBudget] = useState(DEFAULT_RUN_SETTINGS.tokenBudget);
  const [startNow, setStartNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<AgentProfile[]>('GET', '/profiles')
      .then((list) => {
        if (!alive) return;
        setProfiles(list);
        // 默认勾上前三个模板，让"三次点击就能开场"成立
        setPicks(
          list.slice(0, 3).map((profile) => ({
            profile,
            stance: '',
            aggressiveness: profile.aggressiveness,
            priority: 50,
            type: 'debater' as const,
          })),
        );
      })
      .catch((cause: unknown) => setError(describeError(cause)));
    return () => {
      alive = false;
    };
  }, []);

  const picked = useMemo(() => new Set(picks.map((pick) => pick.profile.id)), [picks]);

  const toggle = (profile: AgentProfile) => {
    setPicks((current) =>
      current.some((pick) => pick.profile.id === profile.id)
        ? current.filter((pick) => pick.profile.id !== profile.id)
        : [...current, { profile, stance: '', aggressiveness: profile.aggressiveness, priority: 50, type: 'debater' as const }],
    );
  };

  const patch = (id: string, changes: Partial<Pick>) =>
    setPicks((current) => current.map((pick) => (pick.profile.id === id ? { ...pick, ...changes } : pick)));

  const canAdvance = (): string | null => {
    if (step === 1 && title.trim().length === 0) return '给这个空间起个名字';
    if (step === 2 && mode === 'structured' && topic.trim().length === 0) return '主题辩论必须填写议题';
    if (step === 3 && picks.length === 0) return '至少选择一个角色';
    return null;
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await api<{ id: string }>('POST', '/rooms', {
        title: title.trim(),
        description: description.trim(),
        mode,
        moderatorEnabled,
      });

      for (const pick of picks) {
        await api('POST', `/rooms/${room.id}/roles`, {
          name: pick.profile.name,
          type: pick.type,
          systemPrompt: pick.profile.systemPrompt,
          color: pick.profile.avatarColor,
          profileId: pick.profile.id,
          stance: pick.stance,
          aggressiveness: pick.aggressiveness,
          priority: pick.priority,
        });
      }

      if (moderatorEnabled) {
        // 没有策略的管理员等于没有规则；第一步就把默认策略发布出去，版本从 v1 起
        await api('POST', `/rooms/${room.id}/policy`, {
          rules: DEFAULT_RULES,
          ladder: ['remind', 'warn', 'mute', 'kick'],
        });
      }

      if (startNow) {
        await api('POST', `/rooms/${room.id}/start`, {
          topic: (mode === 'structured' ? topic : title).trim(),
          goal,
          completionCriteria,
          settings: { maxRounds, tokenBudget },
        });
      }

      navigate(`/rooms/${room.id}`);
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
    }
  };

  return (
    <Shell>
      <Top title="创建聊天室" sub="五步建立一个受控但不失锋芒的讨论空间" />
      <section className="wizard content">
        <div className="steps">
          {LABELS.map((label, index) => (
            <button
              key={label}
              className={step === index + 1 ? 'active' : ''}
              onClick={() => setStep(index + 1)}
              type="button"
            >
              <span>{index + 1}</span>
              {label}
            </button>
          ))}
        </div>

        <div className="formcard">
          {step === 1 && (
            <>
              <span className="eyebrow">STEP 01</span>
              <h2>先给这个空间一个名字</h2>
              <label>
                聊天室名称
                <input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label>
                简介
                <textarea
                  value={description}
                  maxLength={500}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
            </>
          )}

          {step === 2 && (
            <>
              <span className="eyebrow">STEP 02</span>
              <h2>选择讨论的运行方式</h2>
              <div className="pickgrid">
                <button
                  type="button"
                  className={`pick ${mode === 'structured' ? 'selected' : ''}`}
                  onClick={() => setMode('structured')}
                >
                  <Gavel />
                  <b>主题辩论</b>
                  <p>围绕明确议题，按目标和轮次推进</p>
                </button>
                <button
                  type="button"
                  className={`pick ${mode === 'free' ? 'selected' : ''}`}
                  onClick={() => setMode('free')}
                >
                  <Sparkles />
                  <b>自由聊天</b>
                  <p>允许角色自主延展，但仍受预算约束</p>
                </button>
              </div>
              <label>
                {mode === 'structured' ? '讨论议题（必填）' : '可选话题引子'}
                <input value={topic} maxLength={500} onChange={(event) => setTopic(event.target.value)} />
              </label>
              <label>
                讨论目标
                <input value={goal} maxLength={500} onChange={(event) => setGoal(event.target.value)} />
              </label>
              <label>
                完成条件
                <input
                  value={completionCriteria}
                  maxLength={500}
                  onChange={(event) => setCompletionCriteria(event.target.value)}
                />
              </label>
            </>
          )}

          {step === 3 && (
            <>
              <span className="eyebrow">STEP 03</span>
              <h2>邀请有鲜明立场的角色</h2>
              {profiles.length === 0 && <Notice kind="info">正在读取角色库…</Notice>}
              <div className="agentpick">
                {profiles.map((profile) => (
                  <button
                    type="button"
                    key={profile.id}
                    className={picked.has(profile.id) ? 'selected' : ''}
                    onClick={() => toggle(profile)}
                  >
                    <span className="avatar" style={{ background: profile.avatarColor }}>
                      {profile.name.slice(0, 1)}
                    </span>
                    <b>{profile.name}</b>
                    <small>{profile.tagline}</small>
                    {picked.has(profile.id) && <Check />}
                  </button>
                ))}
              </div>
              {picks.map((pick) => (
                <div className="pickrows" key={pick.profile.id}>
                  <b>{pick.profile.name}</b>
                  <input
                    placeholder="加入本房间的临时立场（留空则不预设）"
                    value={pick.stance}
                    maxLength={500}
                    onChange={(event) => patch(pick.profile.id, { stance: event.target.value })}
                  />
                  <label className="mini">
                    积极度 {pick.aggressiveness}
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={pick.aggressiveness}
                      onChange={(event) => patch(pick.profile.id, { aggressiveness: Number(event.target.value) })}
                    />
                  </label>
                  <label className="mini">
                    角色类型
                    <select
                      value={pick.type}
                      onChange={(event) => patch(pick.profile.id, { type: event.target.value as RoleType })}
                    >
                      <option value="debater">辩论者</option>
                      <option value="host">主持人</option>
                      <option value="observer">观察者</option>
                    </select>
                  </label>
                </div>
              ))}
              <Link to="/roles" className="secondary">
                <Plus />
                自定义新角色
              </Link>
            </>
          )}

          {step === 4 && (
            <>
              <span className="eyebrow">STEP 04</span>
              <h2>让管理员守住讨论边界</h2>
              <label className="toggle">
                <span>
                  <b>启用 AI 管理员</b>
                  <small>偏题时按阶梯提醒、警告与禁言</small>
                </span>
                <input
                  type="checkbox"
                  checked={moderatorEnabled}
                  onChange={(event) => setModeratorEnabled(event.target.checked)}
                />
              </label>
              <div className="budget">
                <label>
                  最大轮次
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={maxRounds}
                    onChange={(event) => setMaxRounds(Number(event.target.value))}
                  />
                </label>
                <label>
                  Token 预算
                  <input
                    type="number"
                    min={100}
                    step={500}
                    value={tokenBudget}
                    onChange={(event) => setTokenBudget(Number(event.target.value))}
                  />
                </label>
              </div>
              {moderatorEnabled && (
                <p className="hint">将发布默认策略 v1：偏离主题 / 霸占发言 / 攻击与骚扰 / 重复灌水 / 禁区话题。</p>
              )}
              <label className="toggle">
                <span>
                  <b>创建后立即开始讨论</b>
                  <small>否则可以先进去看看角色和规则</small>
                </span>
                <input type="checkbox" checked={startNow} onChange={(event) => setStartNow(event.target.checked)} />
              </label>
            </>
          )}

          {step === 5 && (
            <>
              <span className="eyebrow">READY</span>
              <h2>一切就绪，随时开场</h2>
              <div className="summary">
                <p>
                  <b>名称</b>
                  <span>{title}</span>
                </p>
                <p>
                  <b>模式</b>
                  <span>{mode === 'structured' ? '主题辩论' : '自由聊天'}</span>
                </p>
                <p>
                  <b>议题</b>
                  <span>{topic || '—'}</span>
                </p>
                <p>
                  <b>角色</b>
                  <span>{picks.map((pick) => pick.profile.name).join(' · ')}</span>
                </p>
                <p>
                  <b>治理</b>
                  <span>{moderatorEnabled ? '提醒 → 警告 → 限时禁言 → 移出' : '未启用'}</span>
                </p>
                <p>
                  <b>上限</b>
                  <span>
                    {maxRounds} 轮 · {tokenBudget.toLocaleString('en-US')} tokens
                  </span>
                </p>
              </div>
            </>
          )}

          {error && <Notice kind="error">{error}</Notice>}

          <div className="actions">
            <button
              className="secondary"
              type="button"
              disabled={step === 1}
              onClick={() => setStep(step - 1)}
            >
              上一步
            </button>
            {step < 5 ? (
              <button
                className="primary"
                type="button"
                onClick={() => {
                  const blocker = canAdvance();
                  if (blocker) {
                    setError(blocker);
                    return;
                  }
                  setError(null);
                  setStep(step + 1);
                }}
              >
                继续 <ChevronRight />
              </button>
            ) : (
              <button className="primary" type="button" disabled={busy} onClick={() => void submit()}>
                {busy ? '正在创建…' : '创建并进入房间'}
              </button>
            )}
          </div>
        </div>
      </section>
    </Shell>
  );
}
