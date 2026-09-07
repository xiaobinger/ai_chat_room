import './setup-env';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { type AddressInfo } from 'node:net';
import { prisma } from '@tianma/database';
import { buildApp } from '../app';

const suffix = `${Date.now().toString(36)}w${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'test-password-123';

let app: FastifyInstance;
let base = '';
const createdUserIds: string[] = [];

interface Session {
  id: string;
  token: string;
}

async function register(name: string): Promise<Session> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: `${name}.${suffix}@ws.test`, password: PASSWORD, displayName: name },
  });
  const body = response.json() as { token: string; user: { id: string } };
  createdUserIds.push(body.user.id);
  return { id: body.user.id, token: body.token };
}

async function createRoom(owner: Session): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/rooms',
    payload: { title: `WS 测试房间 ${suffix}`, mode: 'free' },
    headers: { authorization: `Bearer ${owner.token}` },
  });
  return (response.json() as { id: string }).id;
}

/**
 * 连上房间 WS。两种结局取其一：
 * 收到第一条事件（成功握手后服务端会立刻推 hello）或被关闭（鉴权被拒）。
 * Promise 只 resolve 一次，所以两条路径谁先到算谁。
 */
function connect(roomId: string, token?: string): Promise<{ closed?: { code: number; reason: string }; event?: unknown }> {
  return new Promise((resolve, reject) => {
    const url = `${base}/api/v1/rooms/${roomId}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('ws 连接超时'));
    }, 8000);

    socket.on('message', (raw) => {
      clearTimeout(timer);
      const event = JSON.parse(String(raw)) as unknown;
      // 成功路径：拿到第一条事件就够了，主动断开
      socket.close(1000, 'done');
      resolve({ event });
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ closed: { code, reason: reason.toString() } });
    });
  });
}

beforeAll(async () => {
  app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  base = `ws://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
  if (createdUserIds.length > 0) {
    await prisma.discussionRun.deleteMany({ where: { createdBy: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe('WebSocket 鉴权', () => {
  it('不带 token 握手被关闭，代码 4401', async () => {
    const owner = await register('ws-owner');
    const roomId = await createRoom(owner);
    const result = await connect(roomId);
    expect(result.closed?.code).toBe(4401);
  });

  it('伪造的 token 同样被拒', async () => {
    const owner = await register('ws-forge');
    const roomId = await createRoom(owner);
    const result = await connect(roomId, 'this.is.not.a.jwt');
    expect(result.closed?.code).toBe(4401);
  });

  it('非成员进不了私有房间，代码 4403', async () => {
    const owner = await register('ws-host');
    const stranger = await register('ws-stranger');
    const roomId = await createRoom(owner);
    const result = await connect(roomId, stranger.token);
    expect(result.closed?.code).toBe(4403);
  });

  it('成员握手成功并收到 hello，随后能收到房间内广播的消息', async () => {
    const owner = await register('ws-member');
    const roomId = await createRoom(owner);

    const hello = await connect(roomId, owner.token);
    expect(hello.event).toMatchObject({ type: 'hello', payload: { roomId, userId: owner.id } });

    // 新开一条连接，验证"入网之后房间里的广播真的会推给它"
    const received = new Promise<Record<string, unknown>>((resolve, reject) => {
      const socket = new WebSocket(
        `${base}/api/v1/rooms/${roomId}/ws?token=${encodeURIComponent(owner.token)}`,
      );
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error('没有收到广播消息'));
      }, 8000);
      socket.on('message', (raw) => {
        const event = JSON.parse(String(raw)) as Record<string, unknown>;
        if (event.type === 'message') {
          clearTimeout(timer);
          socket.close(1000, 'ok');
          resolve(event);
        }
      });
      socket.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    // 等 socket 注册进网关后再发消息，否则会输给竞态
    await new Promise((done) => setTimeout(done, 300));
    await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${roomId}/messages`,
      payload: { content: '实时推送测试' },
      headers: { authorization: `Bearer ${owner.token}` },
    });

    const event = await received;
    expect((event.payload as { content: string; senderType: string }).content).toBe('实时推送测试');
    expect((event.payload as { senderType: string }).senderType).toBe('user');
  });
});
