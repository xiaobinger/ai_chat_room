import { loadEnv } from '@tianma/database/load-env';

// 必须最先执行：queue / cors / ws 都要读 process.env，
// 而 `pnpm --filter @tianma/api dev` 会把 cwd 设到包目录，.env 只在仓库根。
loadEnv();

import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { assertJwtConfigured } from './auth/tokens';
import { HttpError, isRoomParticipant, resolveUser } from './auth/guards';
import { authPlugin } from './plugins/auth';
import { roomsPlugin } from './plugins/rooms';
import { membershipsPlugin } from './plugins/memberships';
import { runsPlugin } from './plugins/runs';
import { moderationPlugin } from './plugins/moderation';
import { policyPlugin } from './plugins/policy';
import { profilesPlugin } from './plugins/profiles';
import { entertainmentPlugin } from './plugins/entertainment';
import { roomGateway } from './ws/room-gateway';

const OPEN = 1;

function corsOrigins(): string[] | boolean {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) return false;
  if (raw === '*') return true;
  return raw.split(',').map((origin) => origin.trim()).filter(Boolean);
}

function errorMeta(error: unknown): { code: string; name: string; message: string; issues?: unknown } {
  const record = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
    issues?: unknown;
  };
  return {
    code: typeof record.code === 'string' ? record.code : '',
    name: typeof record.name === 'string' ? record.name : '',
    message: typeof record.message === 'string' ? record.message : '',
    issues: record.issues,
  };
}

function installErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, _request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof HttpError) {
      void reply.status(error.status).send({ error: error.code, message: error.message });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const status = error.code === 'P2025' ? 404 : error.code === 'P2002' ? 409 : 400;
      void reply.status(status).send({ error: error.code });
      return;
    }
    const meta = errorMeta(error);
    // Fastify 的请求解析类错误（空 JSON 体、content-type 不支持等）属于客户端问题，
    // 落到 500 分支既给错状态码，又会在错误日志里制造噪音
    if (meta.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      void reply.status(415).send({ error: 'unsupported_media_type' });
      return;
    }
    if (meta.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || meta.code === 'FST_REQ_FILE_TOO_LARGE') {
      void reply.status(413).send({ error: 'body_too_large' });
      return;
    }
    if (meta.code.startsWith('FST_ERR_CTP') || meta.code === 'FST_ERR_VALIDATION') {
      void reply.status(400).send({ error: 'invalid_request', message: meta.message });
      return;
    }
    if (meta.name === 'ZodError') {
      void reply.status(400).send({ error: 'invalid_input', issues: meta.issues });
      return;
    }
    reply.request.log.error({ err: error }, 'unhandled error');
    void reply.status(500).send({ error: 'internal_error' });
  });

  app.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply) => {
    void reply.status(404).send({ error: 'route_not_found' });
  });
}

/**
 * 只构建、不监听。测试可以在不起 TCP 的情况下 inject 请求，
 * 也不会像修复前那样 import 一个模块就悄悄建出第二个连接池。
 */
export async function buildApp(): Promise<FastifyInstance> {
  assertJwtConfigured();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
    // 讨论消息可能较长，同时给 WS 留出帧空间
    bodyLimit: 256 * 1024,
  });

  await app.register(cors, { origin: corsOrigins(), credentials: true });
  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });

  app.addHook('onRequest', async (request) => {
    resolveUser(request);
  });

  installErrorHandling(app);

  app.get('/health', async () => ({
    ok: true,
    queue: (await import('./queue')).runQueue.driver,
    envFile: (await import('@tianma/database')).loadedEnvFile,
  }));

  app.register(authPlugin, { prefix: '/api/v1/auth' });
  // rooms 插件内部路由是 /:roomId/...，所以挂 /api/v1/rooms；
  // 其余三个插件内部已写全 /rooms/:roomId/...，必须挂 /api/v1，
  // 否则会拼出 /api/v1/rooms/rooms/:roomId/... 这种没人调得到的路径
  app.register(roomsPlugin, { prefix: '/api/v1/rooms' });
  app.register(membershipsPlugin, { prefix: '/api/v1' });
  app.register(runsPlugin, { prefix: '/api/v1' });
  app.register(moderationPlugin, { prefix: '/api/v1' });
  app.register(policyPlugin, { prefix: '/api/v1' });
  app.register(profilesPlugin, { prefix: '/api/v1' });
  app.register(entertainmentPlugin, { prefix: '/api/v1/entertainment' });

  /**
   * WebSocket 握手无法携带自定义请求头，所以只能从 ?token= 取，
   * 并且必须验签 + 校验房间成员身份后才允许入网。
   */
  app.get('/api/v1/rooms/:roomId/ws', { websocket: true }, (socket, request) => {
    const { roomId } = request.params as { roomId: string };
    const user = request.authUser;

    if (!roomId) {
      socket.send(JSON.stringify({ type: 'error', payload: { message: 'missing_room_id' } }));
      socket.close(1008, 'missing_room_id');
      return;
    }
    if (!user) {
      socket.close(4401, 'unauthorized');
      return;
    }

    void isRoomParticipant(user.id, roomId).then(
      (allowed) => {
        if (!allowed) {
          socket.close(4403, 'forbidden');
          return;
        }
        roomGateway.add(roomId, socket);
        socket.send(JSON.stringify({ type: 'hello', payload: { roomId, userId: user.id } }));
        roomGateway.broadcast(roomId, { type: 'presence', payload: { userId: user.id, status: 'online' } });

        socket.on('message', (raw: Buffer | string | Buffer[]) => {
          if (socket.readyState !== OPEN) return;
          const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            socket.send(JSON.stringify({ type: 'error', payload: { message: 'invalid_json' } }));
            return;
          }
          const type =
            typeof parsed === 'object' && parsed !== null && 'type' in parsed
              ? String((parsed as { type: unknown }).type)
              : '';
          if (type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong', payload: { ts: Date.now() } }));
            return;
          }
          socket.send(JSON.stringify({ type: 'error', payload: { message: 'unsupported_client_message' } }));
        });

        socket.on('close', () => {
          roomGateway.broadcast(roomId, { type: 'presence', payload: { userId: user.id, status: 'offline' } });
        });
      },
      () => socket.close(1011, 'internal_error'),
    );
  });

  await app.ready();
  return app;
}
