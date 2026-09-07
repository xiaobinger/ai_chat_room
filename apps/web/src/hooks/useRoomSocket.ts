import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Message,
  ModerationEvent,
  RoleRunState,
  RunStatus,
  RunTerminationReason,
  WSEvent,
} from '@tianma/contracts';
import { api, getToken, roomSocketUrl } from '../lib/api';

export interface RunInfo {
  runId: string;
  status: RunStatus;
  currentRound?: number;
  terminationReason?: RunTerminationReason | null;
}

export interface RoomFeed {
  messages: Message[];
  roleStates: Record<string, RoleRunState>;
  run: RunInfo | null;
  moderations: ModerationEvent[];
  online: number;
  connected: boolean;
  problem: string | null;
  /** 手动触发一次重连，供界面放"重试"按钮 */
  retry(): void;
}

/** 心跳间隔要小于常见的 60s 代理空闲超时，否则 nginx 会掐掉静默连接 */
const PING_MS = 25_000;
const MAX_BACKOFF_MS = 15_000;

/**
 * 房间实时消息流。
 *
 * 关键设计（对应验收 #6"不丢、不重、顺序一致"）：
 * - **DB 是唯一真相**，WS 只是活性提示。Pub/Sub 是 fire-and-forget，丢一条不该丢数据。
 * - 每次连接（含重连）都以已收到的最大 `sequence` 为游标，向 REST 回补缺口。
 * - 所有消息按 id 落进一张 Map 再按 sequence 排序输出，
 *   所以"回补与实时推送同时到达同一条消息"这种竞态天然被去重。
 */
export function useRoomFeed(
  roomId: string | null,
  seed: Message[],
  initialRun: RunInfo | null,
): RoomFeed {
  const [messages, setMessages] = useState<Record<string, Message>>(() => indexById(seed));
  const [roleStates, setRoleStates] = useState<Record<string, RoleRunState>>({});
  const [run, setRun] = useState<RunInfo | null>(initialRun);
  const [moderations, setModerations] = useState<ModerationEvent[]>([]);
  const [online, setOnline] = useState(0);
  const [connected, setConnected] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const sequenceRef = useRef(seed.reduce((max, message) => Math.max(max, message.sequence), 0));
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  // seed 变化时（切房间 / 首屏加载完成）并入已有集合，不丢弃已收到的实时更新。
  // 刻意与下面的 run 同步分开：混在一起时一个 effect 触发两次 setState 会互相放大。
  useEffect(() => {
    if (seed.length === 0) return;
    let changed = false;
    setMessages((current) => {
      const next = { ...current };
      for (const message of seed) {
        if (!next[message.id]) {
          next[message.id] = message;
          changed = true;
        }
        sequenceRef.current = Math.max(sequenceRef.current, message.sequence);
      }
      return changed ? next : current;
    });
  }, [seed]);

  // 只在真的不同时才写，否则调用方每次 render 传新对象就会形成渲染回环
  useEffect(() => {
    setRun((current) =>
      current?.runId === initialRun?.runId &&
      current?.status === initialRun?.status &&
      current?.currentRound === initialRun?.currentRound
        ? current
        : initialRun,
    );
  }, [initialRun]);

  useEffect(() => {
    if (!roomId) return;
    const token = getToken();
    if (!token) {
      setProblem('未登录，无法建立实时连接');
      return;
    }

    let socket: WebSocket | null = null;
    let pingTimer: number | null = null;
    let backoff = 1000;
    let closed = false;

    /** 以已收到的最大序号向后端回补缺口。 */
    const backfill = async () => {
      try {
        const missing = await api<Message[]>(
          'GET',
          `/rooms/${roomId}/messages?after=${sequenceRef.current}&limit=200`,
        );
        if (missing.length === 0) return;
        setMessages((current) => {
          const next = { ...current };
          for (const message of missing) {
            if (!next[message.id]) next[message.id] = message;
            sequenceRef.current = Math.max(sequenceRef.current, message.sequence);
          }
          return next;
        });
      } catch (error) {
        setProblem(error instanceof Error ? error.message : '回补历史消息失败');
      }
    };

    const accept = (event: WSEvent) => {
      switch (event.type) {
        case 'message': {
          const message = event.payload;
          sequenceRef.current = Math.max(sequenceRef.current, message.sequence);
          setMessages((current) =>
            current[message.id] ? current : { ...current, [message.id]: message },
          );
          return;
        }
        case 'role_state':
          setRoleStates((current) => ({ ...current, [event.payload.roleId]: event.payload.state }));
          return;
        case 'run_status': {
          const { runId, status, currentRound, terminationReason } = event.payload;
          setRun({
            runId,
            status,
            currentRound,
            terminationReason: terminationReason ?? null,
          });
          return;
        }
        case 'moderation_event':
          setModerations((current) => [event.payload.event, ...current]);
          return;
        case 'presence':
          setOnline((current) =>
            Math.max(0, current + (event.payload.status === 'online' ? 1 : -1)),
          );
          return;
        case 'hello':
          setConnected(true);
          setProblem(null);
          backoff = 1000;
          void backfill();
          return;
        case 'error':
          setProblem(event.payload.message);
          return;
        case 'pong':
          return;
      }
    };

    const connect = () => {
      if (closed) return;
      socket = new WebSocket(roomSocketUrl(roomId, token));

      socket.onmessage = (raw) => {
        try {
          accept(JSON.parse(String(raw.data)) as WSEvent);
        } catch {
          setProblem('收到无法解析的服务端事件');
        }
      };

      socket.onclose = (event) => {
        setConnected(false);
        // 4401/4403 是服务端主动拒绝，重连只会一直失败，必须停下来把原因显示出来
        if (event.code === 4401 || event.code === 4403) {
          setProblem(event.code === 4401 ? '登录状态已失效，请重新登录' : '你不是这个房间的成员');
          return;
        }
        if (closed) return;
        setProblem(null);
        const delay = backoff;
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        window.setTimeout(connect, delay);
      };

      socket.onerror = () => socket?.close();
    };

    connect();
    pingTimer = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
    }, PING_MS);

    return () => {
      closed = true;
      if (pingTimer !== null) window.clearInterval(pingTimer);
      socket?.close();
    };
  }, [roomId, attempt]);

  const sorted = useMemo(
    () => Object.values(messages).sort((a, b) => a.sequence - b.sequence),
    [messages],
  );

  return { messages: sorted, roleStates, run, moderations, online, connected, problem, retry };
}

function indexById(list: Message[]): Record<string, Message> {
  const out: Record<string, Message> = {};
  for (const message of list) out[message.id] = message;
  return out;
}
