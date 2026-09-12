import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Crown, MessageSquareQuote, Moon, Skull, Sparkles, Sun, Timer, Vote as VoteIcon, Users } from 'lucide-react';

// ===== 通用视角类型（各游戏字段按需取用） =====

export interface GamePlayerView {
  playerId: string;
  nickname: string;
  seatNumber?: number;
  isAlive: boolean;
  persona?: string;
  role?: string;
  roleLabel?: string;
  isMe?: boolean;
  hasDescribed?: boolean;
  hasSpoken?: boolean;
  hasSearched?: boolean;
  suspicionLevel?: number;
  character?: {
    name?: string;
    role?: string;
    gender?: 'male' | 'female' | 'unknown';
    personality?: string;
    age?: number;
    height?: number;
    weight?: number;
    specialAbility?: string;
  };
  word?: string;
}

export interface GameEventView {
  id: string;
  round: number;
  phase: string;
  type: string;
  actorName?: string;
  targetName?: string;
  content: string;
  timestamp: number;
}

export interface GameViewState {
  game: string;
  phase: string;
  round: number;
  players: GamePlayerView[];
  events?: GameEventView[];
  myRole?: string;
  myWord?: string;
  winner?: string;
  /** 正在调用大模型生成发言的 AI 玩家 id */
  typingPlayerId?: string | null;
  [key: string]: unknown;
}

export type ActFn = (type: string, extra?: { targetId?: string; content?: string }) => Promise<void>;

// ===== 倒计时 =====

export function Countdown({ deadline, onExpire }: { deadline: number | null; onExpire?: () => void }) {
  const [now, setNow] = useState(Date.now());
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
  }, [deadline]);

  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [deadline]);

  if (!deadline) return null;
  const left = Math.max(0, deadline - now);
  if (left === 0 && !firedRef.current) {
    firedRef.current = true;
    // 到点后稍等后端托管完成再刷新
    window.setTimeout(() => onExpire?.(), 1200);
  }
  const seconds = Math.ceil(left / 1000);
  const urgent = seconds <= 10;
  return (
    <span className={`countdown ${urgent ? 'urgent' : ''}`}>
      <Timer size={14} />
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  );
}

// ===== 阶段徽标 =====

export function PhaseBadge({ phase, round }: { phase: string; round: number }) {
  const map: Record<string, { name: string; icon: typeof Moon; cls: string }> = {
    night: { name: '夜晚', icon: Moon, cls: 'night' },
    day: { name: '白天', icon: Sun, cls: 'day' },
    vote: { name: '投票', icon: VoteIcon, cls: 'vote' },
    voting: { name: '投票', icon: VoteIcon, cls: 'vote' },
    final_speech: { name: '临终遗言', icon: MessageSquareQuote, cls: 'day' },
    describing: { name: '描述', icon: Sun, cls: 'day' },
    investigation: { name: '调查讨论', icon: Sun, cls: 'day' },
    introduction: { name: '自我介绍', icon: Sun, cls: 'day' },
    discussion: { name: '圆桌讨论', icon: Sun, cls: 'day' },
    result: { name: '结算', icon: Skull, cls: 'end' },
    reveal: { name: '真相揭晓', icon: Skull, cls: 'end' },
    finished: { name: '已结束', icon: Skull, cls: 'end' },
  };
  const info = map[phase] ?? { name: phase, icon: Sun, cls: 'day' };
  const Icon = info.icon;
  return (
    <span className={`phase-badge ${info.cls}`}>
      <Icon size={15} />
      {info.name}
      <small>第 {round} 轮</small>
    </span>
  );
}

// ===== 我的身份卡 =====

export function RoleCard({ title, roleName, description, accent }: { title: string; roleName: string; description?: string; accent?: string }) {
  return (
    <div className={`role-card ${accent ?? ''}`}>
      <small>{title}</small>
      <b>{roleName}</b>
      {description && <p>{description}</p>}
    </div>
  );
}

export function HostSummaryCard({
  title,
  label,
  summary,
  highlights,
  tone = 'neutral',
}: {
  title: string;
  label?: string;
  summary: string;
  highlights?: string[];
  tone?: 'neutral' | 'warn' | 'danger';
}) {
  return (
    <div className={`host-summary-card ${tone}`}>
      <div className="host-summary-head">
        <span className="host-summary-kicker">
          <Sparkles size={14} />
          主持总结
        </span>
        {label && <span className="host-summary-label">{label}</span>}
      </div>
      <h4>{title}</h4>
      <p>{summary}</p>
      {(highlights ?? []).length > 0 && (
        <div className="host-summary-tags">
          {(highlights ?? []).map((item, index) => (
            <span key={`${item}-${index}`}>{item}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function PhaseSpotlight({
  phaseKey,
  title,
  subtitle,
  tone = 'neutral',
}: {
  phaseKey: string;
  title: string;
  subtitle?: string;
  tone?: 'neutral' | 'warn' | 'danger';
}) {
  const [visible, setVisible] = useState(true);
  const firstKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const isFirst = firstKeyRef.current === null;
    firstKeyRef.current = phaseKey;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), isFirst ? 2000 : 1700);
    return () => window.clearTimeout(timer);
  }, [phaseKey]);

  if (!visible) return null;

  return (
    <div className={`phase-spotlight ${tone}`}>
      <span className="phase-spotlight-kicker">阶段切换</span>
      <b>{title}</b>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

export function StageVeil({
  stageKey,
  title,
  subtitle,
  tone = 'neutral',
}: {
  stageKey: string;
  title: string;
  subtitle?: string;
  tone?: 'neutral' | 'warn' | 'danger';
}) {
  const [visible, setVisible] = useState(true);
  const firstKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const isFirst = firstKeyRef.current === null;
    firstKeyRef.current = stageKey;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), isFirst ? 950 : 820);
    return () => window.clearTimeout(timer);
  }, [stageKey]);

  if (!visible) return null;

  return (
    <div className={`stage-veil ${tone}`} aria-hidden="true">
      <div className="stage-veil-copy">
        <small>转场</small>
        <b>{title}</b>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}

// ===== 胜负横幅 =====

export function WinnerBanner({ text, tone }: { text: string; tone: 'good' | 'bad' | 'neutral' }) {
  return (
    <div className={`winner-banner ${tone} reveal`}>
      <Crown size={20} />
      <b>{text}</b>
    </div>
  );
}

export function RevealBanner({
  title,
  subtitle,
  items,
  tone = 'neutral',
}: {
  title: string;
  subtitle?: string;
  items?: string[];
  tone?: 'neutral' | 'warn' | 'danger';
}) {
  return (
    <div className={`reveal-banner ${tone}`}>
      <div className="reveal-banner-copy">
        <small>关键揭示</small>
        <b>{title}</b>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {(items ?? []).length > 0 && (
        <div className="reveal-banner-tags">
          {(items ?? []).map((item, index) => (
            <span key={`${item}-${index}`}>{item}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ResultRevealCard({
  eyebrow,
  title,
  tone = 'neutral',
  delayMs = 0,
}: {
  eyebrow: string;
  title: string;
  tone?: 'neutral' | 'good' | 'bad' | 'warn';
  delayMs?: number;
}) {
  return (
    <div className={`result-reveal-card ${tone}`} style={{ animationDelay: `${delayMs}ms` }}>
      <small>{eyebrow}</small>
      <b>{title}</b>
    </div>
  );
}

// ===== 玩家格子 =====

export function PlayerChips({
  players,
  voteStatus,
  speechStatus,
  currentSpeakerId,
  showRoles,
  focusedPlayerIds,
}: {
  players: GamePlayerView[];
  voteStatus?: Record<string, string>;
  speechStatus?: Record<string, string>;
  currentSpeakerId?: string | null;
  showRoles?: boolean;
  focusedPlayerIds?: string[];
}) {
  const roleLabels: Record<string, string> = {
    werewolf: '狼人',
    villager: '村民',
    seer: '预言家',
    witch: '女巫',
    hunter: '猎人',
    thief: '小偷',
    detective: '侦探',
    citizen: '普通市民',
    master_thief: '神偷',
    accomplice: '同伙',
    witness: '目击者',
    civilian: '平民',
    undercover: '卧底',
  };

  return (
    <div className="player-chips">
      {players.map((p) => (
        <div
          key={p.playerId}
          className={`player-chip ${!p.isAlive ? 'dead' : ''} ${currentSpeakerId === p.playerId ? 'speaking' : ''} ${p.isMe ? 'me' : ''} ${focusedPlayerIds?.includes(p.playerId) ? 'focus' : ''}`}
        >
          <span className="player-avatar">{p.nickname.slice(0, 1)}</span>
          {p.seatNumber && <span className="chip-tag">{p.seatNumber}号</span>}
          <span className="player-name">{p.nickname}</span>
          {p.isMe && <span className="chip-tag me">我</span>}
          {showRoles && p.role && <span className="chip-tag role">{p.roleLabel ?? roleLabels[p.role] ?? p.role}</span>}
          {showRoles && p.character?.name && <span className="chip-tag role">{p.character.name}</span>}
          {currentSpeakerId === p.playerId && <span className="chip-tag active">发言中</span>}
          {!p.isAlive && <span className="chip-tag dead">出局</span>}
          {voteStatus?.[p.playerId] === 'voted' && <span className="chip-tag done">已投</span>}
          {voteStatus?.[p.playerId] === 'abstained' && <span className="chip-tag muted">弃票</span>}
          {speechStatus?.[p.playerId] === 'spoken' && <span className="chip-tag done">已发言</span>}
          {speechStatus?.[p.playerId] === 'skipped' && <span className="chip-tag muted">沉默</span>}
          {p.hasDescribed === true && <span className="chip-tag done">已描述</span>}
          {p.hasSpoken === true && <span className="chip-tag done">已发言</span>}
          {p.hasSearched === true && <span className="chip-tag done">已搜证</span>}
        </div>
      ))}
    </div>
  );
}

// ===== 事件时间线 =====

const EVENT_COLORS: Record<string, string> = {
  game_start: '#7457ff',
  phase_change: '#ad9eff',
  player_action: '#5ee9a3',
  player_death: '#ff9b91',
  player_eliminated: '#ff9b91',
  vote_result: '#ffbd75',
  game_end: '#ff758c',
  clue_found: '#5ee9a3',
  clue_discovered: '#5ee9a3',
  special_event: '#ffbd75',
  roleplay: '#8ec9ff',
};

export function Timeline({ events, focusTerms }: { events: GameEventView[]; focusTerms?: string[] }) {
  const recent = [...(events ?? [])].reverse().slice(0, 40);
  const keyMoment = recent.find((event) => ['player_death', 'player_eliminated', 'vote_result', 'game_end', 'special_event'].includes(event.type));
  return (
    <div className="game-timeline">
      <h4>游戏进程</h4>
      {keyMoment && (
        <div className={`timeline-flash ${keyMoment.type}`}>
          <small>最近关键节点</small>
          <b>{keyMoment.content}</b>
          <span>第 {keyMoment.round} 轮</span>
        </div>
      )}
      {recent.length === 0 && <p className="hint">游戏即将开始...</p>}
      {recent.map((event) => {
        const focused = (focusTerms ?? []).some((term) => term && event.content.includes(term));
        return (
          <div key={event.id} className={`timeline-item ${event.type} ${focused ? 'focused' : ''}`}>
            <span className="timeline-dot" style={{ background: EVENT_COLORS[event.type] ?? '#8e90a0' }} />
            <div className="timeline-content">
              <p>{event.content}</p>
              <small>第 {event.round} 轮</small>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== 发言输入 =====

export function SpeechInput({
  placeholder,
  disabled,
  onSpeak,
  onSkip,
  skipLabel = '保持沉默',
  maxLength = 200,
}: {
  placeholder: string;
  disabled: boolean;
  onSpeak: (content: string) => void;
  onSkip?: () => void;
  skipLabel?: string;
  maxLength?: number;
}) {
  const [text, setText] = useState('');
  const submit = () => {
    const value = text.trim();
    if (!value) return;
    onSpeak(value);
    setText('');
  };
  return (
    <div className="speech-input">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        rows={2}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="speech-actions">
        <button className="action-btn primary" disabled={disabled || !text.trim()} onClick={submit}>
          发言
        </button>
        {onSkip && (
          <button className="action-btn secondary" disabled={disabled} onClick={onSkip}>
            {skipLabel}
          </button>
        )}
      </div>
    </div>
  );
}

// ===== 投票面板 =====

export function VoteGrid({
  players,
  myPlayerId,
  disabled,
  onVote,
  onAbstain,
}: {
  players: GamePlayerView[];
  myPlayerId: string | null;
  disabled: boolean;
  onVote: (targetId: string) => void | Promise<void>;
  onAbstain?: () => void | Promise<void>;
}) {
  const targets = players.filter((p) => p.isAlive && p.playerId !== myPlayerId);
  const [lockedTargetId, setLockedTargetId] = useState<string | null>(null);
  const [lockedAbstain, setLockedAbstain] = useState(false);

  useEffect(() => {
    if (!disabled) {
      setLockedTargetId(null);
      setLockedAbstain(false);
    }
  }, [disabled, players.length]);

  return (
    <div className="vote-section">
      <h4>
        <VoteIcon size={15} />
        投票
        {(lockedTargetId || lockedAbstain) && <span className="chip-tag active">已锁定</span>}
      </h4>
      <div className="vote-options">
        {targets.map((p) => (
          <button
            key={p.playerId}
            className={`vote-btn ${lockedTargetId === p.playerId ? 'locked' : ''}`}
            disabled={disabled || Boolean(lockedTargetId) || lockedAbstain}
            onClick={async () => {
              setLockedTargetId(p.playerId);
              setLockedAbstain(false);
              try {
                await Promise.resolve(onVote(p.playerId));
              } catch {
                setLockedTargetId(null);
              }
            }}
          >
            <span className="player-avatar small">{p.nickname.slice(0, 1)}</span>
            {p.seatNumber ? `${p.seatNumber}号 ` : ''}
            {p.nickname}
            {lockedTargetId === p.playerId && <span className="chip-tag active">锁票中</span>}
          </button>
        ))}
      </div>
      {onAbstain && (
        <button
          className={`action-btn ghost ${lockedAbstain ? 'locked' : ''}`}
          disabled={disabled || Boolean(lockedTargetId) || lockedAbstain}
          onClick={async () => {
            setLockedTargetId(null);
            setLockedAbstain(true);
            try {
              await Promise.resolve(onAbstain());
            } catch {
              setLockedAbstain(false);
            }
          }}
        >
          {lockedAbstain ? '弃票已锁定' : '弃票'}
        </button>
      )}
    </div>
  );
}

// ===== 说明区块 =====

export function InfoBlock({ children }: { children: ReactNode }) {
  return <div className="info-block">{children}</div>;
}

export function PlayerCount({ players }: { players: GamePlayerView[] }) {
  const alive = players.filter((p) => p.isAlive).length;
  return (
    <span className="player-count">
      <Users size={14} />
      {alive}/{players.length} 存活
    </span>
  );
}

// ===== 正在输入过渡 =====

export function TypingIndicator({
  players,
  typingPlayerId,
}: {
  players: GamePlayerView[];
  typingPlayerId?: string | null;
}) {
  if (!typingPlayerId) return null;
  const player = players.find((p) => p.playerId === typingPlayerId);
  return (
    <div className="day-message typing">
      <b>{player?.nickname ?? '…'}：</b>
      <span className="typing-dots">
        <i />
        <i />
        <i />
        <small>正在输入</small>
      </span>
    </div>
  );
}
