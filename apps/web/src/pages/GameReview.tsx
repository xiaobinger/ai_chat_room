import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Trophy, Users } from 'lucide-react';
import { api } from '../lib/api';
import { Shell, Top, Notice } from '../components/Shell';

interface GameEvent {
  id: string;
  round: number;
  phase: string;
  type: 'phase_change' | 'player_action' | 'player_death' | 'vote_result' | 'game_start' | 'game_end';
  actorName?: string;
  targetName?: string;
  content: string;
  timestamp: number;
  role?: string;
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
  }[];
  events: GameEvent[];
  winner?: string;
}

const GAME_LABELS: Record<string, string> = {
  werewolf: '狼人杀',
  murder_mystery: '剧本杀',
  who_is_the_thief: '谁是凶手',
};

const ROLE_LABELS: Record<string, string> = {
  werewolf: '狼人',
  villager: '村民',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
};

const EVENT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  game_start: { label: '游戏开始', color: '#7457ff' },
  phase_change: { label: '阶段切换', color: '#ad9eff' },
  player_action: { label: '玩家行动', color: '#5ee9a3' },
  player_death: { label: '玩家死亡', color: '#ff9b91' },
  vote_result: { label: '投票结果', color: '#ffbd75' },
  game_end: { label: '游戏结束', color: '#ff758c' },
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

        {/* 游戏概览 */}
        <div className="review-overview">
          <div className="overview-card">
            <Trophy />
            <div>
              <span>获胜方</span>
              <b>{review.winner === 'werewolf' ? '🐺 狼人' : review.winner === 'villager' ? '👥 村民' : '未知'}</b>
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
            {review.players.map((p) => {
              const gameData = review.events.find((e) => e.actorName === p.nickname)?.role;
              return (
                <div key={p.id} className="player-role-card">
                  <span className="avatar" style={{ background: p.role === 'ai' ? '#6f52d9' : '#2871c9' }}>
                    {p.nickname.slice(0, 1)}
                  </span>
                  <div>
                    <b>{p.nickname}</b>
                    <small>
                      {p.role === 'ai' ? 'AI 玩家' : '人类玩家'}
                      {gameData && ` · ${ROLE_LABELS[gameData] ?? gameData}`}
                    </small>
                  </div>
                </div>
              );
            })}
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
                      </span>
                      <span className="event-round">
                        第 {event.round} 轮
                        {event.phase && ` · ${event.phase === 'night' ? '夜晚' : event.phase === 'day' ? '白天' : event.phase === 'vote' ? '投票' : event.phase}`}
                      </span>
                    </div>
                    <p className="event-text">{event.content}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Shell>
  );
}
