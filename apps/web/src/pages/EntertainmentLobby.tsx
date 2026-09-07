import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { api } from '../lib/api';
import { Shell, Top, Notice, SectionHead } from '../components/Shell';

interface GameRoom {
  id: string;
  title: string;
  gameType: string;
  gameStatus: string;
  visibility: string;
  owner: { id: string; displayName: string };
  _count: { gamePlayers: number };
  minPlayers: number | null;
  maxPlayers: number | null;
}

const GAME_LABELS: Record<string, string> = {
  werewolf: '狼人杀',
  murder_mystery: '剧本杀',
  who_is_the_thief: '谁是凶手',
};

const STATUS_LABELS: Record<string, string> = {
  waiting: '等待中',
  ready: '已满员',
  playing: '游戏中',
  finished: '已结束',
};

export default function EntertainmentLobby() {
  const [rooms, setRooms] = useState<GameRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    api<GameRoom[]>('GET', '/entertainment/rooms')
      .then(setRooms)
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Shell>
      <Top
        title="娱乐空间"
        sub="创建或加入游戏房间，与好友一起玩游戏"
        action={
          <Link to="/entertainment/new" className="primary">
            <Plus />
            创建房间
          </Link>
        }
      />
      <div className="content">
        <SectionHead title="游戏房间" right={<span>共 {rooms.length} 个</span>} />

        {loading && <Notice kind="info">加载中...</Notice>}
        {problem && <Notice kind="error">{problem}</Notice>}

        {!loading && rooms.length === 0 && (
          <Notice kind="info">
            还没有游戏房间。点击右上角"创建房间"开始一局游戏！
          </Notice>
        )}

        <div className="roomgrid">
          {rooms.map((room) => (
            <Link to={`/entertainment/${room.id}`} className="roomcard" key={room.id}>
              <span className={`roomicon game ${room.gameType}`}>
                <Users />
              </span>
              <div>
                <b>{room.title}</b>
                <p>
                  {GAME_LABELS[room.gameType] ?? room.gameType} · {room.owner.displayName}
                </p>
                <small>
                  {room._count.gamePlayers}/{room.maxPlayers ?? '∞'} 人 ·{' '}
                  <span className={`status-badge ${room.gameStatus}`}>
                    {STATUS_LABELS[room.gameStatus] ?? room.gameStatus}
                  </span>
                </small>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Shell>
  );
}
