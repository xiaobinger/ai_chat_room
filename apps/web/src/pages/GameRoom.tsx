import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, Play, Plus, RotateCcw, Trash2, UserMinus, UserPlus, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useGameRoomSocket } from '../hooks/useGameRoomSocket';
import { useAdaptiveGameBgm } from '../hooks/useAdaptiveGameBgm';
import { Shell, Top, Notice } from '../components/Shell';
import { WerewolfView } from '../components/WerewolfView';
import { ThiefGameView } from '../components/ThiefGameView';
import { MysteryView } from '../components/MysteryView';
import { UndercoverView } from '../components/UndercoverView';
import { PlayerChips, WinnerBanner, type GameViewState } from '../components/game-parts';

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
  owner: { id: string; displayName: string };
  gamePlayers: GamePlayer[];
}

interface GameStateResponse {
  gameStatus: string;
  gameType: string;
  myPlayerId: string | null;
  deadline: number | null;
  view: GameViewState | null;
}

const GAME_LABELS: Record<string, string> = {
  werewolf: '狼人杀',
  murder_mystery: '剧本杀',
  who_is_the_thief: '谁是小偷',
  who_is_undercover: '谁是卧底',
};

const STATUS_LABELS: Record<string, string> = {
  waiting: '等待玩家',
  ready: '已满员',
  playing: '游戏中',
  finished: '已结束',
};

const WINNER_TEXT: Record<string, Record<string, string>> = {
  werewolf: { werewolf: '狼人阵营获胜！', villager: '好人阵营获胜！' },
  who_is_the_thief: { thief: '小偷阵营获胜！', citizen: '市民阵营获胜！' },
  murder_mystery: { murderer: '凶手获胜！', detectives: '侦探们获胜！' },
  who_is_undercover: { undercover: '卧底获胜！', civilians: '平民获胜！' },
};

export default function GameRoom() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [room, setRoom] = useState<GameRoomDetail | null>(null);
  const [state, setState] = useState<GameStateResponse | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reloadSeq = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++reloadSeq.current;
    try {
      const [roomData, stateData] = await Promise.all([
        api<GameRoomDetail>('GET', `/entertainment/rooms/${id}`),
        api<GameStateResponse>('GET', `/entertainment/rooms/${id}/state`).catch(() => null),
      ]);
      if (seq !== reloadSeq.current) return; // 过期响应，丢弃
      setRoom(roomData);
      setState(stateData);
      setProblem(null);
    } catch (e: unknown) {
      if (seq !== reloadSeq.current) return;
      setProblem(e instanceof Error ? e.message : '加载失败');
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // WS 实时：任何 game_* 事件触发整页刷新
  const { connected } = useGameRoomSocket(id, () => void reload());

  // 轮询兜底：断线或等待中每 5s 刷一次
  useEffect(() => {
    if (connected) return;
    if (room?.gameStatus !== 'playing' && room?.gameStatus !== 'ready' && room?.gameStatus !== 'waiting') return;
    const timer = window.setInterval(() => void reload(), 5000);
    return () => window.clearInterval(timer);
  }, [connected, room?.gameStatus, reload]);

  const isOwner = user?.id === room?.owner.id;
  const myPlayer = useMemo(
    () => room?.gamePlayers.find((p) => p.userId === user?.id) ?? null,
    [room, user],
  );
  const playing = room?.gameStatus === 'playing';
  const finished = room?.gameStatus === 'finished';
  const canStart = room?.gameStatus === 'waiting' || room?.gameStatus === 'ready';
  const bgm = useAdaptiveGameBgm({
    gameType: room?.gameType,
    phase: state?.view?.phase ?? null,
    gameStatus: room?.gameStatus,
  });

  const run = async (fn: () => Promise<unknown>, failText: string) => {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      await reload();
    } catch (e: unknown) {
      setProblem(e instanceof Error ? e.message : failText);
    } finally {
      setBusy(false);
    }
  };

  const act = useCallback(
    async (type: string, extra?: { targetId?: string; content?: string }) => {
      try {
        const result = await api<{ view: GameViewState; deadline: number | null }>(
          'POST',
          `/entertainment/rooms/${id}/action`,
          { type, ...extra },
        );
        setState((prev) => (prev ? { ...prev, view: result.view, deadline: result.deadline } : prev));
        // 广播只发给其他人，本地立即再拉一次房间详情（生死/阶段变化）
        void reload();
      } catch (e: unknown) {
        setProblem(e instanceof Error ? e.message : '操作失败');
      }
    },
    [id, reload],
  );

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

  const view = state?.view ?? null;
  const gameLabel = GAME_LABELS[room.gameType] ?? room.gameType;
  const iAmAlive = view ? (view.players.find((p) => p.playerId === state?.myPlayerId)?.isAlive ?? false) : false;

  return (
    <Shell>
      <Top
        title={room.title}
        sub={`${gameLabel} · ${STATUS_LABELS[room.gameStatus] ?? room.gameStatus}`}
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {bgm.supported && (
              <button className={`secondary bgm-toggle ${bgm.enabled ? 'on' : 'off'}`} onClick={() => void bgm.toggleEnabled()}>
                {bgm.enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                {bgm.enabled ? '氛围音乐已开' : '开启氛围音乐'}
              </button>
            )}
            {playing && (connected ? <Wifi size={16} className="conn-ok" /> : <WifiOff size={16} className="conn-bad" />)}
            <Link to="/entertainment" className="secondary">
              <ArrowLeft />
              返回大厅
            </Link>
            {finished && (
              <Link to={`/entertainment/${id}/review`} className="secondary">
                查看复盘
              </Link>
            )}
          </div>
        }
      />
      <div className="content">
        {problem && <Notice kind="error">{problem}</Notice>}
        {bgm.supported && (
          <div className="bgm-panel">
            <div className="bgm-copy">
              <small>氛围背景音乐</small>
              <b>{bgm.profile.label}</b>
              <p>{bgm.profile.description}</p>
            </div>
            <div className="bgm-controls">
              <button className={`secondary bgm-pill ${bgm.enabled ? 'on' : 'off'}`} onClick={() => void bgm.toggleEnabled()}>
                {bgm.enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                {bgm.enabled ? '已启用' : '已静音'}
              </button>
              <label className="bgm-slider">
                <span>音量 {bgm.volume}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={bgm.volume}
                  onChange={(event) => bgm.setVolume(Number(event.target.value))}
                  disabled={!bgm.enabled}
                />
              </label>
              {bgm.enabled && !bgm.unlocked && (
                <button className="secondary bgm-pill" onClick={() => void bgm.resume()}>
                  点我唤醒音乐
                </button>
              )}
            </div>
          </div>
        )}

        {/* ===== 等待阶段 ===== */}
        {(canStart || (!playing && !finished)) && (
          <>
            <div className="formcard">
              <h2>房间准备</h2>
              <p className="hint">
                {gameLabel} · {room.gamePlayers.length}/{room.maxPlayers ?? '∞'} 人
                {room.minPlayers ? `（至少 ${room.minPlayers} 人开局）` : ''}
              </p>
              <div className="member-section">
                <div className="panelhead">
                  <span>玩家列表</span>
                  <b>{room.gamePlayers.length}</b>
                </div>
                {room.gamePlayers.map((p) => {
                  const owner = p.userId === room.owner.id;
                  return (
                    <div className="agent" key={p.id}>
                      <span
                        className="avatar"
                        style={{ background: p.profile?.avatarColor ?? p.user?.avatarColor ?? (p.role === 'ai' ? '#6f52d9' : '#2871c9') }}
                      >
                        {p.nickname.slice(0, 1)}
                      </span>
                      <div>
                        <b>
                          {p.nickname}
                          {p.role === 'ai' && <span className="id-badge ai">AI</span>}
                          {owner && <span className="id-badge owner">房主</span>}
                        </b>
                        <small>{p.role === 'ai' ? 'AI 玩家' : '人类玩家'}</small>
                      </div>
                      {isOwner && p.role === 'ai' && (
                        <button
                          className="link-danger"
                          disabled={busy}
                          onClick={() => void run(() => api('DELETE', `/entertainment/rooms/${id}/ai/${p.id}`), '移除失败')}
                        >
                          <UserMinus size={14} />
                        </button>
                      )}
                      {isOwner && p.role === 'human' && !owner && (
                        <button
                          className="link-danger"
                          disabled={busy}
                          onClick={() => void run(() => api('DELETE', `/entertainment/rooms/${id}/players/${p.id}`), '踢出失败')}
                        >
                          <UserMinus size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="actions">
                {canStart && isOwner && (
                  <>
                    <button
                      className="primary"
                      disabled={busy || (room.minPlayers ? room.gamePlayers.length < room.minPlayers : false)}
                      onClick={() => void run(() => api('POST', `/entertainment/rooms/${id}/start`, {}), '开局失败')}
                    >
                      <Play />
                      开始游戏
                    </button>
                    <button
                      className="secondary"
                      disabled={busy || (room.maxPlayers ? room.gamePlayers.length >= room.maxPlayers : false)}
                      onClick={() =>
                        void run(
                          () =>
                            api('POST', `/entertainment/rooms/${id}/ai`, {
                              nickname: `AI 玩家 ${room.gamePlayers.filter((p) => p.role === 'ai').length + 1}`,
                            }),
                          '添加 AI 失败',
                        )
                      }
                    >
                      <Bot />
                      添加 AI
                    </button>
                  </>
                )}
                {canStart && !myPlayer && (
                  <button
                    className="primary"
                    disabled={busy || (room.maxPlayers ? room.gamePlayers.length >= room.maxPlayers : false)}
                    onClick={() => void run(() => api('POST', `/entertainment/rooms/${id}/join`, {}), '加入失败')}
                  >
                    <UserPlus />
                    加入游戏
                  </button>
                )}
                {canStart && myPlayer && !isOwner && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void run(() => api('POST', `/entertainment/rooms/${id}/leave`, {}), '离开失败')}
                  >
                    <UserMinus />
                    离开房间
                  </button>
                )}
                {canStart && isOwner && room.gamePlayers.length < (room.minPlayers ?? 4) && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const missing = (room.minPlayers ?? 4) - room.gamePlayers.length;
                        for (let i = 0; i < missing; i++) {
                          await api('POST', `/entertainment/rooms/${id}/ai`, {
                            nickname: `AI 玩家 ${room.gamePlayers.filter((p) => p.role === 'ai').length + i + 1}`,
                          });
                        }
                      }, '添加 AI 失败')
                    }
                  >
                    <Plus />
                    AI 凑满开局人数
                  </button>
                )}
                {canStart && isOwner && (
                  <button
                    className="link-danger"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('确定解散房间？解散后所有数据将被清除，无法恢复。')) {
                        void run(async () => {
                          await api('DELETE', `/entertainment/rooms/${id}`);
                          window.location.href = '/entertainment';
                        }, '解散失败');
                      }
                    }}
                  >
                    <Trash2 />
                    解散房间
                  </button>
                )}
              </div>
              {canStart && isOwner && room.minPlayers && room.gamePlayers.length < room.minPlayers && (
                <Notice kind="info">
                  还差 {room.minPlayers - room.gamePlayers.length} 人达到最低开局人数，可以邀请好友或用 AI 补位。
                </Notice>
              )}
            </div>
          </>
        )}

        {/* ===== 游戏进行中 / 已结束 ===== */}
        {(playing || finished) && (
          <>
            {!view && playing && <Notice kind="info">正在同步游戏状态...</Notice>}
            {view && room.gameType === 'werewolf' && (
              <WerewolfView
                view={view}
                myPlayerId={state?.myPlayerId ?? null}
                alive={iAmAlive}
                deadline={state?.deadline ?? null}
                act={act}
                refresh={() => void reload()}
              />
            )}
            {view && room.gameType === 'who_is_the_thief' && (
              <ThiefGameView
                view={view}
                myPlayerId={state?.myPlayerId ?? null}
                alive={iAmAlive}
                deadline={state?.deadline ?? null}
                act={act}
                refresh={() => void reload()}
              />
            )}
            {view && room.gameType === 'murder_mystery' && (
              <MysteryView
                view={view}
                myPlayerId={state?.myPlayerId ?? null}
                alive={iAmAlive}
                deadline={state?.deadline ?? null}
                act={act}
                refresh={() => void reload()}
              />
            )}
            {view && room.gameType === 'who_is_undercover' && (
              <UndercoverView
                view={view}
                myPlayerId={state?.myPlayerId ?? null}
                alive={iAmAlive}
                deadline={state?.deadline ?? null}
                act={act}
                refresh={() => void reload()}
              />
            )}
            {finished && view && (
              <div className="game-section">
                <h4>最终身份</h4>
                <PlayerChips players={view.players ?? []} showRoles />
              </div>
            )}
            {finished && !view && room.gamePlayers.length > 0 && (
              <WinnerBanner
                text={WINNER_TEXT[room.gameType]?.[''] ?? '本局已结束'}
                tone="neutral"
              />
            )}
            {finished && (
              <div className="actions" style={{ marginTop: 16 }}>
                {isOwner && (
                  <>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void run(() => api('POST', `/entertainment/rooms/${id}/restart`, {}), '重开失败')}
                    >
                      <RotateCcw />
                      再来一局
                    </button>
                    <button
                      className="link-danger"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm('确定解散房间？解散后所有数据将被清除，无法恢复。')) {
                          void run(async () => {
                            await api('DELETE', `/entertainment/rooms/${id}`);
                            window.location.href = '/entertainment';
                          }, '解散失败');
                        }
                      }}
                    >
                      <Trash2 />
                      解散房间
                    </button>
                  </>
                )}
                <Link to={`/entertainment/${id}/review`} className="secondary">
                  查看完整复盘
                </Link>
                <Link to="/entertainment" className="secondary">
                  返回大厅
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
