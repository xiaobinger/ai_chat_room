import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Trophy, Users } from 'lucide-react';
import { api } from '../lib/api';
import { Shell, Top, Notice } from '../components/Shell';

interface GameEvent {
  id: string;
  round: number;
  phase: string;
  type: string;
  actorName?: string;
  targetName?: string;
  content: string;
  timestamp: number;
  /** 秘密事件（狼刀/查验/女巫用药等），终局复盘全量公开 */
  secret?: boolean;
}

interface GameReviewData {
  room: {
    id: string;
    title: string;
    gameType: string;
    gameStatus: string;
    createdAt: string;
  };
  players: {
    id: string;
    nickname: string;
    role: 'human' | 'ai';
    isAlive: boolean;
    gameRole: string | null;
    won: boolean | null;
  }[];
  events: GameEvent[];
  winner?: string;
}

const GAME_LABELS: Record<string, string> = {
  werewolf: '狼人杀',
  murder_mystery: '剧本杀',
  who_is_the_thief: '谁是小偷',
  who_is_undercover: '谁是卧底',
};

const WINNER_LABELS: Record<string, Record<string, string>> = {
  werewolf: { werewolf: '狼人阵营', villager: '好人阵营' },
  murder_mystery: { murderer: '凶手', detectives: '侦探们' },
  who_is_the_thief: { thief: '小偷阵营', citizen: '市民阵营' },
  who_is_undercover: { undercover: '卧底', civilians: '平民' },
};

const EVENT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  game_start: { label: '游戏开始', color: '#7457ff' },
  phase_change: { label: '阶段切换', color: '#ad9eff' },
  player_action: { label: '玩家行动', color: '#5ee9a3' },
  player_death: { label: '玩家死亡', color: '#ff9b91' },
  player_eliminated: { label: '玩家出局', color: '#ff9b91' },
  vote_result: { label: '投票结果', color: '#ffbd75' },
  game_end: { label: '游戏结束', color: '#ff758c' },
  clue_found: { label: '发现线索', color: '#5ee9a3' },
  clue_discovered: { label: '发现线索', color: '#5ee9a3' },
  special_event: { label: '特殊事件', color: '#ffbd75' },
  roleplay: { label: '角色发言', color: '#8ec9ff' },
  night_action: { label: '夜晚密谋', color: '#8ec9ff' },
  judge_speak: { label: '法官', color: '#ffd479' },
  final_speech: { label: '临终遗言', color: '#c9b8ff' },
};

const PHASE_LABELS: Record<string, string> = {
  night: '夜晚',
  day: '白天',
  vote: '投票',
  final_speech: '遗言',
  finished: '终局',
};

export default function GameReview() {
  const { id = '' } = useParams();
  const [review, setReview] = useState<GameReviewData | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<GameReviewData>('GET', `/entertainment/rooms/${id}/review`)
      .then(setReview)
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <Shell>
        <Top title="游戏复盘" sub="加载中..." />
        <div className="content">
          <Notice kind="info">加载中...</Notice>
        </div>
      </Shell>
    );
  }

  if (!review) {
    return (
      <Shell>
        <Top title="游戏复盘" sub="加载失败" />
        <div className="content">
          <Notice kind="error">{problem ?? '无法加载复盘数据'}</Notice>
        </div>
      </Shell>
    );
  }

  const winnerText = review.winner
    ? WINNER_LABELS[review.room.gameType]?.[review.winner] ?? review.winner
    : null;

  return (
    <Shell>
      <Top
        title={review.room.title}
        sub={`${GAME_LABELS[review.room.gameType] ?? review.room.gameType} · 复盘`}
        action={
          <Link to={`/entertainment/${id}`} className="secondary">
            <ArrowLeft />
            返回房间
          </Link>
        }
      />
      <div className="content">
        {problem && <Notice kind="error">{problem}</Notice>}
        {review.room.gameStatus !== 'finished' && (
          <Notice kind="info">本局还未结束，复盘数据将在游戏结束后完整开放。</Notice>
        )}

        {/* 游戏概览 */}
        <div className="review-overview">
          <div className="overview-card">
            <Trophy />
            <div>
              <span>获胜方</span>
              <b>{winnerText ?? '未知'}</b>
            </div>
          </div>
          <div className="overview-card">
            <Users />
            <div>
              <span>玩家数</span>
              <b>{review.players.length}</b>
            </div>
          </div>
          <div className="overview-card">
            <Calendar />
            <div>
              <span>游戏时间</span>
              <b>{new Date(review.room.createdAt).toLocaleDateString('zh-CN')}</b>
            </div>
          </div>
        </div>

        {/* 玩家身份 */}
        <div className="review-section">
          <h3>玩家身份</h3>
          <div className="player-roles">
            {review.players.map((p) => (
              <div key={p.id} className="player-role-card">
                <span className="avatar" style={{ background: p.role === 'ai' ? '#6f52d9' : '#2871c9' }}>
                  {p.nickname.slice(0, 1)}
                </span>
                <div>
                  <b>{p.nickname}</b>
                  <small>
                    {p.role === 'ai' ? 'AI 玩家' : '人类玩家'}
                    {p.gameRole && ` · ${p.gameRole}`}
                    {p.won === true && ' · 🏆 获胜'}
                    {p.won === false && ' · 失败'}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 事件时间线 */}
        <div className="review-section">
          <h3>游戏回放</h3>
          <div className="event-timeline">
            {review.events.map((event) => {
              const typeInfo = EVENT_TYPE_LABELS[event.type] ?? { label: event.type, color: '#8e90a0' };
              return (
                <div key={event.id} className={`event-item ${event.type}`}>
                  <div className="event-marker" style={{ background: typeInfo.color }} />
                  <div className="event-content">
                    <div className="event-header">
                      <span className="event-type" style={{ color: typeInfo.color }}>
                        {typeInfo.label}
                        {event.secret && <span className="event-secret">秘密</span>}
                      </span>
                      <span className="event-round">
                        第 {event.round} 轮 · {PHASE_LABELS[event.phase] ?? event.phase}
                      </span>
                    </div>
                    <p className="event-text">{event.content}</p>
                  </div>
                </div>
              );
            })}
            {review.events.length === 0 && <p className="hint">暂无游戏记录。</p>}
          </div>
        </div>
      </div>
    </Shell>
  );
}
