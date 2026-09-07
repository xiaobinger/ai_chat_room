import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, MessageSquare, Plus } from 'lucide-react';
import type { PublicUser } from '@tianma/contracts';
import { api } from '../lib/api';
import { roomStatusLabel } from '../lib/format';
import { Notice, Shell, Top } from '../components/Shell';

interface RoomListItem {
  id: string;
  title: string;
  description: string;
  mode: 'structured' | 'free';
  status: string;
  visibility: 'public' | 'private';
  ownerId: string;
  messageSeq: number;
  createdAt: string;
  owner: PublicUser;
  roomRoles: { id: string; name: string; type: string; color: string | null }[];
  _count: { messages: number; runs: number; memberships: number };
}

export default function Lobby() {
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api<RoomListItem[]>('GET', '/rooms')
      .then((list) => {
        if (alive) setRooms(list);
      })
      .catch((error: unknown) => {
        if (alive) setProblem(error instanceof Error ? error.message : '加载房间列表失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // hero 优先展示正在进行的房间；没有就退回列表第一个
  const featured = rooms.find((room) => room.status === 'running') ?? rooms[0];

  return (
    <Shell>
      <Top
        title="讨论空间"
        sub="让不同人格的 AI 在规则内充分交锋"
        action={
          <Link className="primary" to="/rooms/new">
            <Plus />
            创建聊天室
          </Link>
        }
      />
      <section className="content">
        {loading && <Notice kind="info">正在读取房间列表…</Notice>}
        {problem && <Notice kind="error">{problem}</Notice>}

        {featured && (
          <div className="hero">
            <div>
              <span className="eyebrow">
                <MessageSquare />
                {featured.status === 'running' ? '正在进行' : '最近讨论'}
              </span>
              <h2>{featured.title}</h2>
              <p>
                {featured.roomRoles.length} 位 AI 角色 · {featured._count.runs} 次讨论 ·{' '}
                {roomStatusLabel(featured.status)}
              </p>
              <Link className="primary light" to={`/rooms/${featured.id}`}>
                进入讨论 <ChevronRight />
              </Link>
            </div>
            <div className="orbit">
              <div className="core">议题</div>
              {featured.roomRoles.slice(0, 3).map((role, index) => (
                <div
                  className={`orb o${index}`}
                  key={role.id}
                  style={role.color ? { background: role.color } : undefined}
                >
                  {role.name.slice(0, 1)}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="sectionhead">
          <h3>最近的聊天室</h3>
          <span>共 {rooms.length} 个</span>
        </div>

        {rooms.length === 0 && !loading ? (
          <Notice kind="info">
            还没有房间。右上角「创建聊天室」建一个，或先跑 <code>pnpm db:seed</code> 拿演示房间。
          </Notice>
        ) : (
          <div className="roomgrid">
            {rooms.map((room, index) => (
              <Link to={`/rooms/${room.id}`} className="roomcard" key={room.id}>
                <span className={`roomicon r${index % 3}`}>
                  <MessageSquare />
                </span>
                <div>
                  <b>{room.title}</b>
                  <p>
                    {room.roomRoles.length} 个角色 · {room._count.messages} 条消息 ·{' '}
                    {room.owner.displayName}
                  </p>
                </div>
                <span className="status">{roomStatusLabel(room.status)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}
