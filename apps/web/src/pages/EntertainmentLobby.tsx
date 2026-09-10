import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Filter, Plus, Search, Trash2, Trophy, Users } from 'lucide-react';
import { api } from '../lib/api';
import { Shell, Top, Notice, SectionHead } from '../components/Shell';
import { useAuth } from '../context/AuthContext';

interface GameStats {
  totalGames: number;
  wins: number;
  losses: number;
  byGameType: Record<string, { total: number; wins: number }>;
}

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
  who_is_the_thief: '谁是小偷',
  who_is_undercover: '谁是卧底',
  unknown: '未知',
};

const STATUS_LABELS: Record<string, string> = {
  waiting: '等待中',
  ready: '已满员',
  playing: '游戏中',
  finished: '已结束',
};

const GAME_TYPES = [
  { id: '', label: '全部' },
  { id: 'werewolf', label: '狼人杀' },
  { id: 'who_is_undercover', label: '谁是卧底' },
  { id: 'murder_mystery', label: '剧本杀' },
  { id: 'who_is_the_thief', label: '谁是小偷' },
];

const STATUS_TYPES = [
  { id: '', label: '全部' },
  { id: 'waiting', label: '等待中' },
  { id: 'ready', label: '已满员' },
  { id: 'playing', label: '游戏中' },
  { id: 'finished', label: '已结束' },
];

export default function EntertainmentLobby() {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<GameRoom[]>([]);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [gameTypeFilter, setGameTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dissolving, setDissolving] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<GameRoom[]>('GET', '/entertainment/rooms'),
      api<GameStats>('GET', '/entertainment/stats'),
    ])
      .then(([roomsData, statsData]) => {
        setRooms(roomsData);
        setStats(statsData);
      })
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const dissolveRoom = async (roomId: string) => {
    if (!window.confirm('确定解散这个房间吗？所有游戏数据将被永久删除，无法恢复。')) return;
    setDissolving(roomId);
    try {
      await api('DELETE', `/entertainment/rooms/${roomId}`);
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
    } catch (e) {
      setProblem(e instanceof Error ? `解散失败：${e.message}` : '解散失败');
    } finally {
      setDissolving(null);
    }
  };

  const filteredRooms = useMemo(() => {
    return rooms.filter((room) => {
      if (search && !room.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (gameTypeFilter && room.gameType !== gameTypeFilter) return false;
      if (statusFilter && room.gameStatus !== statusFilter) return false;
      return true;
    });
  }, [rooms, search, gameTypeFilter, statusFilter]);

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
        {/* 统计卡片 */}
        {stats && stats.totalGames > 0 && (
          <div className="stats-bar">
            <div className="stat-card">
              <BarChart3 />
              <div>
                <span>总场次</span>
                <b>{stats.totalGames}</b>
              </div>
            </div>
            <div className="stat-card">
              <Trophy />
              <div>
                <span>胜利</span>
                <b>{stats.wins}</b>
              </div>
            </div>
            <div className="stat-card">
              <Users />
              <div>
                <span>胜率</span>
                <b>{stats.totalGames > 0 ? Math.round((stats.wins / stats.totalGames) * 100) : 0}%</b>
              </div>
            </div>
            {Object.entries(stats.byGameType).map(([type, data]) => (
              <div className="stat-card small" key={type}>
                <span>{GAME_LABELS[type] ?? type}</span>
                <b>
                  {data.wins}/{data.total}
                </b>
              </div>
            ))}
          </div>
        )}

        {/* 搜索和筛选 */}
        <div className="filter-bar">
          <div className="search-box">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索房间名称..."
            />
          </div>
          <div className="filter-group">
            <Filter size={14} />
            <select value={gameTypeFilter} onChange={(e) => setGameTypeFilter(e.target.value)}>
              {GAME_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_TYPES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        <SectionHead title="游戏房间" right={<span>共 {filteredRooms.length} 个</span>} />

        {loading && <Notice kind="info">加载中...</Notice>}
        {problem && <Notice kind="error">{problem}</Notice>}

        {!loading && filteredRooms.length === 0 && (
          <Notice kind="info">
            {rooms.length === 0
              ? '还没有游戏房间。点击右上角"创建房间"开始一局游戏！'
              : '没有符合条件的房间。'}
          </Notice>
        )}

        <div className="roomgrid">
          {filteredRooms.map((room) => (
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
              {room.owner.id === user?.id && room.gameStatus !== 'playing' && (
                <button
                  className="link-danger"
                  title="解散房间"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void dissolveRoom(room.id);
                  }}
                >
                  <Trash2 size={16} />
                  {dissolving === room.id ? '解散中…' : '解散'}
                </button>
              )}
            </Link>
          ))}
        </div>
      </div>
    </Shell>
  );
}
