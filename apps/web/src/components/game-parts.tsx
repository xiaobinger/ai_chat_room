import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Crown, Moon, Skull, Sun, Timer, Vote as VoteIcon, Users } from 'lucide-react';

// ===== 通用视角类型（各游戏字段按需取用） =====

export interface GamePlayerView {
  playerId: string;
  nickname: string;
  isAlive: boolean;
  role?: string;
  isMe?: boolean;
  hasDescribed?: boolean;
  hasSpoken?: boolean;
  hasSearched?: boolean;
  character?: { name?: string; role?: string; personality?: string };
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

// ===== 胜负横幅 =====

export function WinnerBanner({ text, tone }: { text: string; tone: 'good' | 'bad' | 'neutral' }) {
  return (
    <div className={`winner-banner ${tone}`}>
      <Crown size={20} />
      <b>{text}</b>
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
}: {
  players: GamePlayerView[];
  voteStatus?: Record<string, string>;
  speechStatus?: Record<string, string>;
  currentSpeakerId?: string | null;
  showRoles?: boolean;
}) {
  return (
    <div className="player-chips">
      {players.map((p) => (
        <div
          key={p.playerId}
          className={`player-chip ${!p.isAlive ? 'dead' : ''} ${currentSpeakerId === p.playerId ? 'speaking' : ''} ${p.isMe ? 'me' : ''}`}
        >
          <span className="player-avatar">{p.nickname.slice(0, 1)}</span>
          <span className="player-name">{p.nickname}</span>
          {p.isMe && <span className="chip-tag me">我</span>}
          {showRoles && p.role && <span className="chip-tag role">{p.role}</span>}
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

export function Timeline({ events }: { events: GameEventView[] }) {
  const recent = [...(events ?? [])].reverse().slice(0, 40);
  return (
    <div className="game-timeline">
      <h4>游戏进程</h4>
      {recent.length === 0 && <p className="hint">游戏即将开始...</p>}
      {recent.map((event) => (
        <div key={event.id} className="timeline-item">
          <span className="timeline-dot" style={{ background: EVENT_COLORS[event.type] ?? '#8e90a0' }} />
          <div className="timeline-content">
            <p>{event.content}</p>
            <small>第 {event.round} 轮</small>
          </div>
        </div>
      ))}
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
  onVote: (targetId: string) => void;
  onAbstain?: () => void;
}) {
  const targets = players.filter((p) => p.isAlive && p.playerId !== myPlayerId);
  return (
    <div className="vote-section">
      <h4>
        <VoteIcon size={15} />
        投票
      </h4>
      <div className="vote-options">
        {targets.map((p) => (
          <button
            key={p.playerId}
            className="vote-btn"
            disabled={disabled}
            onClick={() => onVote(p.playerId)}
          >
            <span className="player-avatar small">{p.nickname.slice(0, 1)}</span>
            {p.nickname}
          </button>
        ))}
      </div>
      {onAbstain && (
        <button className="action-btn ghost" disabled={disabled} onClick={onAbstain}>
          弃票
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
