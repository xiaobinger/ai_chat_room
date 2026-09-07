import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Play, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import { Shell, Top, Notice } from '../components/Shell';

interface GamePlayer {
  id: string;
  userId: string | null;
  profileId: string | null;
  nickname: string;
  role: 'human' | 'ai';
  isAlive: boolean;
  user?: { id: string; displayName: string; avatarColor: string | null };
  profile?: { id: string; name: string; avatarColor: string | null };
}

interface GameRoomDetail {
  id: string;
  title: string;
  gameType: string;
  gameStatus: string;
  minPlayers: number | null;
  maxPlayers: number | null;
  gameState: Record<string, unknown> | null;
  owner: { id: string; displayName: string };
  gamePlayers: GamePlayer[];
}

const GAME_LABELS: Record<string, string> = {
  werewolf: '狼人杀',
  murder_mystery: '剧本杀',
  who_is_the_thief: '谁是凶手',
};

const STATUS_LABELS: Record<string, string> = {
  waiting: '等待玩家',
  ready: '已满员',
  playing: '游戏中',
  finished: '已结束',
};

export default function GameRoom() {
  const { id = '' } = useParams();
  const [room, setRoom] = useState<GameRoomDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try {
      const data = await api<GameRoomDetail>('GET', `/entertainment/rooms/${id}`);
      setRoom(data);
    } catch (e: unknown) {
      setProblem(e instanceof Error ? e.message : '加载失败');
    }
  };

  useEffect(() => {
    void reload();
  }, [id]);

  if (!room) {
    return (
      <Shell>
        <Top title="游戏房间" sub="加载中..." />
        <div className="content">
          {problem ? <Notice kind="error">{problem}</Notice> : <Notice kind="info">加载中...</Notice>}
        </div>
      </Shell>
    );
  }

  const isOwner = true; // TODO: 从 auth context 判断
  const canStart = room.gameStatus === 'waiting' || room.gameStatus === 'ready';
  const playing = room.gameStatus === 'playing';

  const handleStart = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api('POST', `/entertainment/rooms/${id}/start`, {});
      await reload();
    } catch (e: unknown) {
      setProblem(e instanceof Error ? e.message : '开局失败');
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api('POST', `/entertainment/rooms/${id}/join`, {});
      await reload();
    } catch (e: unknown) {
      setProblem(e instanceof Error ? e.message : '加入失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <Top
        title={room.title}
        sub={`${GAME_LABELS[room.gameType] ?? room.gameType} · ${STATUS_LABELS[room.gameStatus] ?? room.gameStatus}`}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            {canStart && isOwner && (
              <button className="primary" onClick={handleStart} disabled={busy}>
                <Play />
                开始游戏
              </button>
            )}
            {room.gameStatus === 'waiting' && (
              <button className="secondary" onClick={handleJoin} disabled={busy}>
                <UserPlus />
                加入游戏
              </button>
            )}
          </div>
        }
      />
      <div className="content">
        {problem && <Notice kind="error">{problem}</Notice>}

        <div className="review" style={{ gridTemplateColumns: '1fr' }}>
          <div className="score">
            <strong>{room.gamePlayers.length}</strong>
            <span>/{room.maxPlayers ?? '∞'} 玩家</span>
          </div>
          <div className="member-section">
            <div className="panelhead">
              <span>玩家列表</span>
              <b>{room.gamePlayers.length}</b>
            </div>
            {room.gamePlayers.map((p) => (
              <div className="agent" key={p.id}>
                <span
                  className="avatar"
                  style={{ background: p.profile?.avatarColor ?? p.user?.avatarColor ?? '#6f52d9' }}
                >
                  {p.nickname.slice(0, 1)}
                </span>
                <div>
                  <b>
                    {p.nickname}
                    {p.role === 'ai' && <span className="ai-badge">AI</span>}
                  </b>
                  <small>{p.isAlive ? '存活' : '已出局'}</small>
                </div>
              </div>
            ))}
          </div>
        </div>

        {playing && (
          <div className="formcard">
            <h2>游戏进行中</h2>
            <p>游戏已开始，请等待游戏事件推送...</p>
            <pre className="game-state">{JSON.stringify(room.gameState, null, 2)}</pre>
          </div>
        )}
      </div>
    </Shell>
  );
}
