import type { WebSocket } from 'ws';
import type { WSEvent } from '@tianma/contracts';

// ws 的 READY_STATE.OPEN === 1
const OPEN = 1;

/**
 * 房间 WebSocket 广播网关（API 进程内单例）。
 *
 * 事件类型直接用 contracts 的 WSEvent，不再在本地抄一份联合类型 ——
 * 抄一份就意味着它可以和契约悄悄漂移，而前端只能靠猜。
 */
export class RoomGateway {
  private connections = new Map<string, Set<WebSocket>>();

  add(roomId: string, socket: WebSocket): void {
    let set = this.connections.get(roomId);
    if (!set) {
      set = new Set();
      this.connections.set(roomId, set);
    }
    set.add(socket);
    socket.on('close', () => this.remove(roomId, socket));
    socket.on('error', () => this.remove(roomId, socket));
  }

  remove(roomId: string, socket: WebSocket): void {
    const set = this.connections.get(roomId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.connections.delete(roomId);
  }

  /** 房间里没有连接时，桥可以完全跳过序列化。 */
  hasRoom(roomId: string): boolean {
    const set = this.connections.get(roomId);
    return Boolean(set && set.size > 0);
  }

  broadcast(roomId: string, event: WSEvent): number {
    const set = this.connections.get(roomId);
    if (!set || set.size === 0) return 0;
    const raw = JSON.stringify(event);
    let sent = 0;
    for (const socket of set) {
      if (socket.readyState !== OPEN) {
        this.remove(roomId, socket);
        continue;
      }
      try {
        socket.send(raw);
        sent += 1;
      } catch {
        this.remove(roomId, socket);
      }
    }
    return sent;
  }

  onlineCount(roomId: string): number {
    return this.connections.get(roomId)?.size ?? 0;
  }

  /** 进程退出时统一关掉，避免 PM2 reload 后端口/句柄泄漏。 */
  closeAll(): void {
    for (const set of this.connections.values()) {
      for (const socket of set) {
        try {
          socket.close(1001, 'server_shutdown');
        } catch {
          socket.terminate();
        }
      }
    }
    this.connections.clear();
  }
}

export const roomGateway = new RoomGateway();
