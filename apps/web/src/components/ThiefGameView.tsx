import { useMemo } from 'react';
import { MapPin, Search, Users, Vote, Skull } from 'lucide-react';

interface GamePlayer {
  playerId: string;
  nickname: string;
  role: 'human' | 'ai';
  isAlive: boolean;
}

interface Clue {
  id: string;
  name: string;
  description: string;
  location: string;
  revealsInfo: string;
  isKey: boolean;
  discoveredBy?: string;
}

interface GameEvent {
  id: string;
  round: number;
  phase: string;
  type: string;
  actorName?: string;
  targetName?: string;
  content: string;
  timestamp: number;
}

interface ThiefGameViewProps {
  phase: string;
  round: number;
  players: GamePlayer[];
  clues: Clue[];
  discoveredClues: string[];
  events: GameEvent[];
  votes: Record<string, string>;
  myRole?: string;
  isOwner: boolean;
  canAct: boolean;
  onSearch: () => void;
  onVote: (targetId: string) => void;
}

const PHASE_INFO: Record<string, { name: string; icon: typeof Search; description: string }> = {
  night: { name: '夜晚', icon: Search, description: '侦探正在调查...' },
  day: { name: '白天', icon: Users, description: '所有玩家讨论并寻找线索' },
  vote: { name: '投票', icon: Vote, description: '投票选出你认为的小偷' },
  finished: { name: '结束', icon: Skull, description: '游戏结束' },
};

export function ThiefGameView({
  phase,
  round,
  players,
  clues,
  discoveredClues,
  events,
  votes,
  myRole,
  canAct,
  onSearch,
  onVote,
}: ThiefGameViewProps) {
  const phaseInfo = PHASE_INFO[phase] ?? PHASE_INFO.night;
  const PhaseIcon = phaseInfo.icon;

  const discoveredClueObjects = clues.filter((c) => discoveredClues.includes(c.id));
  const alivePlayers = players.filter((p) => p.isAlive);

  const recentEvents = useMemo(() => {
    return [...events].reverse().slice(0, 10);
  }, [events]);

  const voteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const targetId of Object.values(votes)) {
      if (typeof targetId === 'string') {
        counts[targetId] = (counts[targetId] ?? 0) + 1;
      }
    }
    return counts;
  }, [votes]);

  return (
    <div className="thief-game">
      {/* 游戏状态栏 */}
      <div className="game-header">
        <div className="phase-badge">
          <PhaseIcon size={18} />
          <span>{phaseInfo.name}</span>
          <small>第 {round} 轮</small>
        </div>
        <p className="phase-desc">{phaseInfo.description}</p>
        {myRole && (
          <div className="my-role-badge">
            你是：<span className={`role-${myRole}`}>{getRoleName(myRole)}</span>
          </div>
        )}
      </div>

      {/* 事件时间线 */}
      <div className="narrative">
        <h3>案件进展</h3>
        <div className="timeline">
          {recentEvents.length === 0 && (
            <p className="hint">游戏即将开始...</p>
          )}
          {recentEvents.map((event) => (
            <div key={event.id} className={`timeline-item ${event.type}`}>
              <span className="timeline-dot" />
              <div className="timeline-content">
                <p>{event.content}</p>
                <small>第 {event.round} 轮</small>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 线索区域 */}
      <div className="clues-section">
        <h3>
          <MapPin size={16} />
          已发现线索 ({discoveredClueObjects.length}/{clues.length})
        </h3>
        {discoveredClueObjects.length === 0 ? (
          <p className="hint">还没有发现线索，点击下方按钮搜索</p>
        ) : (
          <div className="clue-cards">
            {discoveredClueObjects.map((clue) => (
              <div key={clue.id} className={`clue-card ${clue.isKey ? 'key' : ''}`}>
                <div className="clue-header">
                  <span className="clue-name">{clue.name}</span>
                  {clue.isKey && <span className="clue-key-badge">关键</span>}
                </div>
                <p className="clue-desc">{clue.description}</p>
                <p className="clue-reveals">{clue.revealsInfo}</p>
                <small className="clue-location">📍 {clue.location}</small>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 玩家列表 */}
      <div className="players-section">
        <h3>
          <Users size={16} />
          玩家 ({alivePlayers.length}/{players.length})
        </h3>
        <div className="player-chips">
          {players.map((p) => (
            <div key={p.playerId} className={`player-chip ${!p.isAlive ? 'dead' : ''}`}>
              <span className="player-avatar" style={{ background: p.role === 'ai' ? '#6f52d9' : '#2871c9' }}>
                {p.nickname.slice(0, 1)}
              </span>
              <span className="player-name">{p.nickname}</span>
              {p.role === 'ai' && <span className="ai-mini">AI</span>}
              {!p.isAlive && <span className="dead-badge">出局</span>}
            </div>
          ))}
        </div>
      </div>

      {/* 行动区域 */}
      {canAct && phase !== 'finished' && (
        <div className="actions-section">
          {phase === 'night' && myRole === 'detective' && (
            <button className="action-btn primary" onClick={onSearch}>
              <Search size={16} />
              调查一名玩家
            </button>
          )}
          {phase === 'day' && (
            <button className="action-btn secondary" onClick={onSearch}>
              <Search size={16} />
              搜索线索
            </button>
          )}
          {phase === 'vote' && (
            <div className="vote-section">
              <h3>
                <Vote size={16} />
                投票选出小偷
              </h3>
              <div className="vote-options">
                {alivePlayers.map((p) => (
                  <button
                    key={p.playerId}
                    className={`vote-btn ${votes[p.playerId] ? 'voted' : ''}`}
                    onClick={() => onVote(p.playerId)}
                  >
                    <span className="player-avatar small" style={{ background: p.role === 'ai' ? '#6f52d9' : '#2871c9' }}>
                      {p.nickname.slice(0, 1)}
                    </span>
                    {p.nickname}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 投票结果 */}
      {phase === 'vote' && Object.keys(voteCounts).length > 0 && (
        <div className="vote-results">
          <h4>当前票数</h4>
          {Object.entries(voteCounts).map(([targetId, count]) => {
            const target = players.find((p) => p.playerId === targetId);
            return (
              <div key={targetId} className="vote-count">
                <span>{target?.nickname ?? '未知'}</span>
                <b>{count} 票</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getRoleName(role: string): string {
  const names: Record<string, string> = {
    thief: '小偷',
    detective: '侦探',
    citizen: '普通市民',
    master_thief: '神偷',
    accomplice: '同伙',
    witness: '目击者',
  };
  return names[role] ?? role;
}
