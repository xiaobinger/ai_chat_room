import { useEffect, useRef, useState } from 'react';
import { getToken, roomSocketUrl } from '../lib/api';

/**
 * 游戏房实时连接：任何 game_* 事件都触发 onChange（前端拉取净化视角）。
 * 与 useRoomFeed 不同，游戏以 DB 为唯一真相，WS 只当"该刷新了"的信号，
 * 所以这里不做消息补偿，断线时由调用方的轮询兜底。
 */
export function useGameRoomSocket(roomId: string | null, onChange: () => void): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  useEffect(() => {
    if (!roomId) return;
    const token = getToken();
    if (!token) return;

    let socket: WebSocket | null = null;
    let pingTimer: number | null = null;
    let backoff = 1000;
    let closed = false;

    const connect = () => {
      if (closed) return;
      socket = new WebSocket(roomSocketUrl(roomId, token));

      socket.onmessage = (raw) => {
        try {
          const event = JSON.parse(String(raw.data)) as { type: string };
          if (event.type.startsWith('game_')) handlerRef.current();
        } catch {
          // 忽略无法解析的帧
        }
      };

      socket.onopen = () => {
        setConnected(true);
        backoff = 1000;
      };

      socket.onclose = () => {
        setConnected(false);
        if (closed) return;
        const delay = backoff;
        backoff = Math.min(backoff * 2, 15_000);
        window.setTimeout(connect, delay);
      };

      socket.onerror = () => socket?.close();
    };

    connect();
    pingTimer = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
    }, 25_000);

    return () => {
      closed = true;
      if (pingTimer !== null) window.clearInterval(pingTimer);
      socket?.close();
      setConnected(false);
    };
  }, [roomId]);

  return { connected };
}
