import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MentionPicker, type MentionTarget } from '../components/MentionPicker';
import {
  Brain,
  CirclePause,
  CirclePlay,
  Gavel,
  MessageSquare,
  Octagon,
  Shield,
  Users,
  X,
} from 'lucide-react';
import type {
  Message,
  ModerationEvent,
  RoleRunState,
  RoomRole,
  RunSettings,
  RunStatus,
} from '@tianma/contracts';
import { api, describeError, getToken } from '../lib/api';
import { useRoomFeed } from '../hooks/useRoomSocket';
import { actionLabel, ratioPercent, relativeTime, roomStatusLabel, runStateLabel } from '../lib/format';
import { Notice } from '../components/Shell';
import { useAuth } from '../context/AuthContext';

interface RoomDetail {
  id: string;
  title: string;
  description: string;
  mode: 'structured' | 'free';
  status: string;
  ownerId: string;
  moderatorEnabled: boolean;
  membersCanChat: boolean;
  isOwner: boolean;
  isMember: boolean;
  online: number;
  messageSeq: number;
  roomRoles: RoomRole[];
  members: { id: string; status: string; intent: string; nickname: string | null; mutedUntilRound: number | null; user: { id: string; displayName: string } }[];
  runs: { id: string; status: string; topic: string; currentRound: number; createdAt: string }[];
}

interface RunDetail {
  id: string;
  status: string;
  topic: string;
  goal: string;
  currentRound: number;
  settings: RunSettings;
  terminationReason: string | null;
  messages: Message[];
  agentStates: { roleId: string; state: RoleRunState; mutedUntilRound: number }[];
}

interface Policy {
  version: number;
  rules: { id: string; label: string; kind: string; enabled: boolean; threshold?: number }[];
  ladder: string[];
}

export default function ChatRoom() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [seed, setSeed] = useState<Message[]>([]);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [historicalEvents, setHistoricalEvents] = useState<ModerationEvent[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionCaret, setMentionCaret] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    if (!getToken()) return;
    try {
      const detail = await api<RoomDetail>('GET', `/rooms/${id}`);
      setRoom(detail);

      const [messages, events] = await Promise.all([
        api<Message[]>('GET', `/rooms/${id}/messages?after=0&limit=200`),
        api<ModerationEvent[]>('GET', `/rooms/${id}/events`),
      ]);
      setSeed(messages);
      setHistoricalEvents(events);

      const latest = detail.runs[0];
      if (latest) {
        const runDetail = await api<RunDetail>('GET', `/rooms/${id}/runs/${latest.id}`);
        setRun(runDetail);
      } else {
        setRun(null);
      }

      try {
        setPolicy(await api<Policy>('GET', `/rooms/${id}/policy`));
      } catch {
        // 还没发布过策略是正常状态，不该弹成错误
        setPolicy(null);
      }
    } catch (error) {
      setProblem(describeError(error));
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 必须是稳定引用：直接写对象字面量会让 hook 内的同步 effect 每次 render 都被触发
  const feedRun = useMemo(
    () =>
      run
        ? {
            runId: run.id,
            status: run.status as RunStatus,
            currentRound: run.currentRound,
          }
        : null,
    [run?.id, run?.status, run?.currentRound],
  );

  const feed = useRoomFeed(id, seed, feedRun);

  const messages = feed.messages;
  // 事件锚到"被处置的那条发言"之后（证据列表的最后一条），而不是堆成消息墙
  const eventsForMessage = useMemo(() => {
    const groups = new Map<string, ModerationEvent[]>();
    for (const event of [...feed.moderations, ...historicalEvents]) {
      const anchor = event.evidenceMessageIds.at(-1);
      if (!anchor) continue;
      const bucket = groups.get(anchor) ?? [];
      // 实时推送与 REST 各带一次同一事件时只保留一份
      if (!bucket.some((entry) => entry.id === event.id)) bucket.push(event);
      groups.set(anchor, bucket);
    }
    return groups;
  }, [feed.moderations, historicalEvents]);

  // 新消息到达时保持贴底，但用户手动上翻时不打断阅读
  const stickToBottom = useRef(true);
  useEffect(() => {
    const node = scroller.current;
    if (node && stickToBottom.current) node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  // 复盘页的「定位原消息」跳到这里：滚到那一条并短暂高亮，然后清掉参数
  const [highlight, setHighlight] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('highlight'),
  );
  useEffect(() => {
    if (!highlight || messages.length === 0) return;
    const row = document.getElementById(`m-${highlight}`);
    if (!row) return;
    stickToBottom.current = false;
    row.classList.add('flash');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => row.classList.remove('flash'), 2400);
    setHighlight(null);
    window.history.replaceState({}, '', window.location.pathname);
  }, [highlight, messages]);

  const roleState = (role: RoomRole): RoleRunState => {
    const live = feed.roleStates[role.id];
    if (live) return live;
    return run?.agentStates.find((state) => state.roleId === role.id)?.state ?? 'idle';
  };

  const spentTokens = messages.reduce((sum, message) => sum + (message.tokens ?? 0), 0);
  const budget = run?.settings.tokenBudget ?? 0;
  const maxRounds = run?.settings.maxRounds ?? 20;
  const currentRound = feed.run?.currentRound ?? run?.currentRound ?? 0;
  const runStatus = feed.run?.status ?? run?.status;
  const running = runStatus === 'running';
  const queued = runStatus === 'queued';
  const paused = runStatus === 'paused';
  const terminal = run ? ['completed', 'terminated'].includes(run.status) : false;

  const command = async (body: Record<string, unknown>) => {
    if (!run) return;
    try {
      await api('POST', `/rooms/${id}/runs/${run.id}/commands`, body);
      await reload();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const restart = async () => {
    if (!run) return;
    try {
      await api('POST', `/rooms/${id}/runs/${run.id}/restart`, {});
      await reload();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const startDiscussion = async () => {
    try {
      await api('POST', `/rooms/${id}/start`, {
        topic: room?.title ?? '',
        goal: room?.description ?? '',
      });
      await reload();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const mentionTargets: MentionTarget[] = useMemo(() => {
    if (!room) return [];
    const roles = room.roomRoles.map((r) => ({ id: r.id, name: r.name, kind: 'role' as const, color: r.color ?? undefined }));
    const members = room.members
      .filter((m) => m.status === 'approved')
      .map((m) => ({
        id: m.user.id,
        name: m.nickname || m.user.displayName,
        kind: 'member' as const,
        displayName: m.user.displayName,
      }));
    return [...roles, ...members];
  }, [room]);

  const handleMentionSelect = (target: MentionTarget) => {
    const before = draft.slice(0, mentionCaret);
    const after = draft.slice(mentionCaret + mentionFilter.length + 1);
    const inserted = `${target.name} `;
    setDraft(before + inserted + after);
    setMentionOpen(false);
    setMentionFilter('');
    inputRef.current?.focus();
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    const caret = inputRef.current?.selectionStart ?? value.length;
    const beforeCaret = value.slice(0, caret);
    const atMatch = beforeCaret.match(/@([^\s@,，。！？!?:：；;]*)$/);
    if (atMatch) {
      setMentionOpen(true);
      setMentionFilter(atMatch[1]);
      setMentionCaret(caret - atMatch[0].length);
    } else {
      setMentionOpen(false);
    }
  };

  const filteredTargets = mentionOpen
    ? mentionTargets.filter((t) => t.name.toLowerCase().includes(mentionFilter.toLowerCase()))
    : [];

  const send = async () => {
    const content = draft.trim();
    if (!content || !room) return;
    setMentionOpen(false);
    setSending(true);
    try {
      await api('POST', `/rooms/${id}/messages`, { content, runId: run?.id ?? null });
      setDraft('');
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setSending(false);
    }
  };

  const join = async () => {
    try {
      const result = await api<{ status: string }>('POST', `/rooms/${id}/join`, { intent: 'discuss' });
      setProblem(
        result.status === 'approved' ? '你已经是这个房间的成员了' : '申请已提交，等待房主审批',
      );
      await reload();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const decide = async (membershipId: string, action: 'approve' | 'reject') => {
    try {
      await api('POST', `/rooms/${id}/memberships/${membershipId}/${action}`, {});
      await reload();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const moderateUser = async (targetUserId: string, action: 'mute' | 'kick' | 'unmute') => {
    const reason = action === 'mute' ? '房主手动禁言' : action === 'kick' ? '房主手动移出' : '房主解除禁言';
    try {
      await api('POST', `/rooms/${id}/moderation`, { action, targetUserId, reason });
      await reload();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const moderateRole = async (targetRoleId: string, action: 'mute' | 'kick' | 'unmute') => {
    const reason = action === 'mute' ? '房主手动禁言' : action === 'kick' ? '房主手动移出' : '房主解除禁言';
    try {
      await api('POST', `/rooms/${id}/moderation`, { action, targetRoleId, reason });
      await reload();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const dissolveRoom = async () => {
    if (!window.confirm('确定要解散这个房间吗？所有消息、角色、成员将被永久删除，此操作不可恢复。')) return;
    try {
      await api('DELETE', `/rooms/${id}`, {});
      navigate('/rooms');
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  // 面具昵称
  const myMembership = room?.members.find((m) => m.user.id === user?.id) ?? null;
  const [nickname, setNickname] = useState(myMembership?.nickname || '');
  const currentNickname = myMembership?.nickname || '';
  const saveNickname = async () => {
    try {
      await api('PATCH', `/rooms/${id}/membership/nickname`, { nickname: nickname.trim() || null });
      await reload();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const [inviteEmail, setInviteEmail] = useState('');
  const invite = async () => {
    if (!inviteEmail) return;
    try {
      await api('POST', `/rooms/${id}/invite`, { email: inviteEmail });
      setInviteEmail('');
      await reload();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const revoke = async (eventId: string) => {
    try {
      await api('POST', `/rooms/${id}/events/${eventId}/revoke`, {});
      await reload();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  if (!room) {
    return (
      <div className="chat">
        <section className="stage">
          <div className="messages">
            {problem ? <Notice kind="error">{problem}</Notice> : <Notice kind="info">正在载入房间…</Notice>}
          </div>
        </section>
      </div>
    );
  }

  const pending = room.members.filter((member) => member.status === 'invited');

  return (
    <div className="chat">
      <aside className="chatnav">
        <Link to="/rooms" className="back">
          ← 所有聊天室
        </Link>
        <div className="mini-brand">天</div>
        <nav>
          <button className="active" type="button">
            <MessageSquare />
            讨论
          </button>
          <Link to={`/rooms/${room.id}/moderation`}>
            <Shield />
            治理规则
          </Link>
          <Link to={`/rooms/${room.id}/runs/${run?.id ?? 'none'}/review`}>
            <Brain />
            讨论复盘
          </Link>
        </nav>
      </aside>

      <section className="stage">
        <header className="chathead">
          <div>
            <span className="live">
              <i />
              {running ? 'LIVE' : queued ? '排队中' : roomStatusLabel(room.status)} · 第 {currentRound} / {maxRounds} 轮
            </span>
            <h1>{room.title}</h1>
          </div>
          <button className="mobile-menu" onClick={() => setDrawer(true)}>
            <Users />
          </button>
        </header>

        <div className="topicline">
          <span>讨论目标</span>
          <p>{run?.goal || room.description || '—'}</p>
          <b>{ratioPercent(currentRound, maxRounds)}%</b>
        </div>

        {!room.isMember && (
          <div className="banner warn">
            你还不是这个房间的成员，可以浏览但不能发言。
            <button onClick={() => void join()}>申请加入</button>
          </div>
        )}
        {problem && (
          <div className="banner">
            {problem}
            <button onClick={() => setProblem(null)}>
              <X />
            </button>
          </div>
        )}
        {!feed.connected && (
          <div className="banner warn">
            实时连接已断开{feed.problem ? `：${feed.problem}` : ''}
            <button onClick={feed.retry}>重连</button>
          </div>
        )}

        <div
          className="messages"
          ref={scroller}
          onScroll={(event) => {
            const node = event.currentTarget;
            stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
          }}
        >
          {messages.length === 0 && <Notice kind="info">还没有消息。启动讨论后角色会依次发言。</Notice>}
          {messages.map((message) => (
            <div key={message.id}>
              <MessageRow message={message} roles={room.roomRoles} members={room.members} />
              {/* 处置说明本身已作为 moderator 消息按 sequence 落在流里；
                  这里只补上可撤销的操作条，锚在它引用的那条消息之后 */}
              {eventsForMessage
                .get(message.id)
                ?.map((event) => (
                  <div className="event" key={event.id}>
                    <Gavel />
                    <div>
                      <b>
                        治理动作：{actionLabel(event.action)}
                        {event.matchedRule ? ` · 命中规则 ${event.matchedRule}` : ''}
                      </b>
                      <p>
                        {event.reason}
                        {event.durationRounds ? `（${event.durationRounds} 轮）` : ''}
                        {event.policyVersion ? ` · 策略 v${event.policyVersion}` : ''}
                        {event.revertedAt ? ' · 已撤销' : ''}
                      </p>
                    </div>
                    {room.isOwner && !event.revertedAt && (
                      <button onClick={() => void revoke(event.id)}>撤销</button>
                    )}
                  </div>
                ))}
            </div>
          ))}
        </div>

        <div className="control">
          {running ? (
            <button className="pause" onClick={() => void command({ command: 'pause' })}>
              <CirclePause />
              暂停讨论
            </button>
          ) : paused ? (
            <button className="play" onClick={() => void command({ command: 'resume' })}>
              <CirclePlay />
              继续讨论
            </button>
          ) : queued ? (
            <span className="queued-hint">排队中...</span>
          ) : null}
          <button onClick={() => void command({ command: 'terminate', terminationReason: 'owner_terminated' })} disabled={!run || terminal}>
            <Octagon />
            终止
          </button>
          {terminal && room.isOwner && (
            <button className="play" onClick={() => void restart()}>
              <CirclePlay />
              重启讨论
            </button>
          )}
          {!run && (
            <button className="play" onClick={() => void startDiscussion()}>
              <CirclePlay />
              启动讨论
            </button>
          )}
          <div className="input-wrap">
            <input
              ref={inputRef}
              value={draft}
              placeholder="插话、追问，或 @某人 来点名…"
              onChange={(event) => handleDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !mentionOpen) {
                  event.preventDefault();
                  void send();
                }
              }}
              onBlur={() => setTimeout(() => setMentionOpen(false), 150)}
            />
            {mentionOpen && (
              <MentionPicker
                targets={filteredTargets}
                anchorRef={inputRef}
                onSelect={handleMentionSelect}
                onClose={() => setMentionOpen(false)}
              />
            )}
          </div>
          <button className="send" onClick={() => void send()} disabled={sending || !room.membersCanChat && !room.isOwner}>
            发送
          </button>
        </div>
      </section>

      <aside className={`panel ${drawer ? 'open' : ''}`}>
        <button className="close" onClick={() => setDrawer(false)}>
          <X />
        </button>
        <div className="panelhead">
          <span>参与角色</span>
          <b>{room.roomRoles.length}</b>
        </div>
        {room.roomRoles.map((role) => {
          const state = roleState(role);
          return (
            <div className="agent" key={role.id}>
              <span className="avatar" style={{ background: role.color ?? '#6f52d9' }}>
                {role.name.slice(0, 1)}
              </span>
              <div>
                <b>{role.name}</b>
                <small>{runStateLabel(state)}</small>
              </div>
              {room.isOwner && state !== 'removed' && (
                <div className="member-actions">
                  {state === 'muted' ? (
                    <button className="unmute-btn" onClick={() => void moderateRole(role.id, 'unmute')}>
                      解除禁言
                    </button>
                  ) : (
                    <button className="mute" onClick={() => void moderateRole(role.id, 'mute')}>
                      禁言
                    </button>
                  )}
                  <button className="reject" onClick={() => void moderateRole(role.id, 'kick')}>
                    移出
                  </button>
                </div>
              )}
              <i className={state} />
            </div>
          );
        })}

        <div className="rulebox">
          <span>
            <Shield />
            AI 管理员
          </span>
          <b>{policy ? `守序者 · v${policy.version}` : room.moderatorEnabled ? '已启用 · 未发布规则' : '未启用'}</b>
          <p>
            {policy
              ? policy.rules
                  .filter((rule) => rule.enabled)
                  .map((rule) => rule.label)
                  .join(' / ')
              : '发布规则后，偏题与越界会被自动处置。'}
          </p>
          <Link to={`/rooms/${room.id}/moderation`}>查看完整规则 →</Link>
        </div>

        {room.isOwner && (
          <div className="member-section">
            <div className="panelhead">
              <span>邀请成员</span>
            </div>
            <div className="invite-row">
              <input
                type="email"
                placeholder="输入邮箱邀请"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <button className="approve" onClick={() => void invite()} disabled={!inviteEmail}>
                邀请
              </button>
            </div>
          </div>
        )}

        {room.isMember && (
          <div className="member-section">
            <div className="panelhead">
              <span>我的面具</span>
            </div>
            <div className="nickname-row">
              <input
                type="text"
                placeholder="设置昵称"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={64}
              />
              <button onClick={() => void saveNickname()}>保存</button>
            </div>
            <p className="hint">
              {currentNickname ? `当前昵称：${currentNickname}` : '未设置昵称，显示你的注册用户名'}
            </p>
          </div>
        )}

        {room.isOwner && (
          <div className="member-section">
            <div className="panelhead">
              <span>加入申请</span>
              <b>{pending.length}</b>
            </div>
            {pending.length === 0 && <p className="hint">暂无待审批申请。</p>}
            {pending.map((member) => (
              <div className="member" key={member.id}>
                <div>
                  <b>{member.user.displayName}</b>
                  <small>{member.intent === 'discuss' ? '参与讨论' : '潜水'}</small>
                </div>
                <div className="member-actions">
                  <button className="approve" onClick={() => void decide(member.id, 'approve')}>
                    通过
                  </button>
                  <button className="reject" onClick={() => void decide(member.id, 'reject')}>
                    拒绝
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="member-section">
          <div className="panelhead">
            <span>当前成员</span>
            <b>{room.members.length}</b>
          </div>
          {room.members.map((member, index) => (
            <div className="agent" key={member.id}>
              <span className="avatar" style={{ background: index === 0 ? '#6f52d9' : '#2871c9' }}>
                {member.user.displayName.slice(0, 1)}
              </span>
              <div>
                <b>{member.user.displayName}</b>
                <small>
                  {member.user.id === room.ownerId
                    ? '房主'
                    : member.intent === 'discuss'
                      ? '参与讨论'
                      : '潜水观察'}
                </small>
              </div>
              {room.isOwner && member.user.id !== room.ownerId && (
                <div className="member-actions">
                  {member.mutedUntilRound != null ? (
                    <button className="unmute-btn" onClick={() => void moderateUser(member.user.id, 'unmute')}>
                      解除禁言
                    </button>
                  ) : (
                    <button className="mute" onClick={() => void moderateUser(member.user.id, 'mute')}>
                      禁言
                    </button>
                  )}
                  <button className="reject" onClick={() => void moderateUser(member.user.id, 'kick')}>
                    移出
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="meter">
          <span>Token 预算</span>
          <b>
            {spentTokens.toLocaleString('en-US')} / {budget.toLocaleString('en-US')}
          </b>
          <i>
            <em style={{ width: `${ratioPercent(spentTokens, budget)}%` }} />
          </i>
        </div>
        <p className="hint">在线 {feed.online || room.online} 人 · 你：{user?.displayName ?? '未登录'}</p>

        {room.isOwner && (
          <button className="danger-btn" onClick={() => void dissolveRoom()}>
            解散房间
          </button>
        )}
      </aside>
    </div>
  );
}

function MessageRow({ message, roles, members }: { message: Message; roles: RoomRole[]; members: RoomDetail['members'] }) {
  const role = roles.find((entry) => entry.id === message.roleId);
  const member = message.senderId ? members.find((m) => m.user.id === message.senderId) : null;
  const label = role?.name ?? (
    message.senderType === 'moderator'
      ? 'AI 管理员'
      : message.senderType === 'system'
        ? '系统'
        : message.senderType === 'user'
          ? member?.nickname || member?.user.displayName || '人类成员'
          : 'AI 角色'
  );
  const background = role?.color ?? (message.senderType === 'user' ? '#2871c9' : '#6f52d9');

  // 构建有效点名名称集合：AI 角色名 + 人类成员昵称/用户名
  const validMentions = new Map<string, string>();
  for (const r of roles) validMentions.set(r.name.toLowerCase(), r.name);
  for (const m of members) {
    const display = m.nickname || m.user.displayName;
    validMentions.set(display.toLowerCase(), display);
    if (m.nickname) validMentions.set(m.user.displayName.toLowerCase(), display);
  }

  // 高亮 @点名：只高亮真正匹配参与者的点名
  const renderContent = (content: string) => {
    const parts = content.split(/(@[^\s@,，。！？!?:：；;]+)/g);
    return parts.map((part, i) => {
      if (!part.startsWith('@')) return part;
      const name = part.slice(1);
      const matched = validMentions.get(name.toLowerCase());
      if (!matched) return part;
      return (
        <span key={i} className="mention" title={`@${matched}`}>
          @{matched}
        </span>
      );
    });
  };

  return (
    <article className="message" id={`m-${message.id}`}>
      <div className="avatar" style={{ background }}>
        {label.slice(0, 1)}
      </div>
      <div>
        <header>
          <b>{label}</b>
          <small>{relativeTime(message.createdAt)}</small>
        </header>
        <p>{renderContent(message.content)}</p>
        {message.status === 'failed' && <div className="modnote">这条发言未完成</div>}
      </div>
    </article>
  );
}
