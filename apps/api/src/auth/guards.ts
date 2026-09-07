import { prisma } from '@tianma/database';
import type { FastifyRequest } from 'fastify';
import { verifyToken, type AuthUser } from './tokens';

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

/** 带 HTTP 状态码的错误；由 app.ts 里的 setErrorHandler 统一转成响应。 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'HttpError';
  }
}

export class Unauthorized extends HttpError {
  constructor(message = 'unauthorized') {
    super(401, message);
  }
}

export class Forbidden extends HttpError {
  constructor(message = 'forbidden') {
    super(403, message);
  }
}

export class NotFound extends HttpError {
  constructor(message = 'not_found') {
    super(404, message);
  }
}

export class Conflict extends HttpError {
  constructor(message = 'conflict') {
    super(409, message);
  }
}

/**
 * 浏览器发起 WebSocket 握手时无法自定义请求头，所以 WS 只能走 `?token=`。
 * HTTP 仍只认 Authorization 头 —— 查询参数会进 access log，不该成为常规 HTTP 鉴权方式。
 */
export function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const query = request.query as { token?: unknown } | undefined;
  if (typeof query?.token === 'string' && query.token) return query.token;
  return null;
}

/** onRequest 钩子：能识别就填 request.authUser，识别不了留匿名，不抛错。 */
export function resolveUser(request: FastifyRequest): void {
  const token = extractToken(request);
  if (!token) return;
  const user = verifyToken(token);
  if (user) request.authUser = user;
}

/** 需要登录的路由用这个；抛 401 而不是返回 null。 */
export function authedUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) throw new Unauthorized();
  return request.authUser;
}

export type RoomAccessLevel = 'read' | 'member' | 'owner';

export interface RoomAccess {
  user: AuthUser;
  room: {
    id: string;
    ownerId: string;
    visibility: 'public' | 'private';
    status: string;
    mode: string;
    title: string;
    membersCanChat: boolean;
    membersCanModifyTopic: boolean;
    membersCanAddRoles: boolean;
    membersCanStartRun: boolean;
    moderatorEnabled: boolean;
  };
  isOwner: boolean;
  isMember: boolean;
}

const ACCESS_SELECT = {
  id: true,
  ownerId: true,
  visibility: true,
  status: true,
  mode: true,
  title: true,
  membersCanChat: true,
  membersCanModifyTopic: true,
  membersCanAddRoles: true,
  membersCanStartRun: true,
  moderatorEnabled: true,
} as const;

/**
 * 房间级授权的唯一入口。
 *
 * 修复前的所有路由都直接从请求体取 ownerId / createdBy / senderId，
 * 任何人只要改一下 body 就能以任意身份建房、发言、治理。
 * 现在身份只来自已验签的 JWT，且房主天然算成员。
 */
export async function roomAccess(
  request: FastifyRequest,
  roomId: string,
  level: RoomAccessLevel,
): Promise<RoomAccess> {
  const user = authedUser(request);
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: ACCESS_SELECT });
  if (!room) throw new NotFound('room_not_found');

  const isOwner = room.ownerId === user.id;
  let isMember = isOwner;
  if (!isMember) {
    const membership = await prisma.membership.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
      select: { status: true },
    });
    isMember = membership?.status === 'approved';
  }

  if (level === 'owner' && !isOwner) throw new Forbidden('owner_only');
  if (level === 'member' && !isMember) throw new Forbidden('room_member_only');
  if (level === 'read' && room.visibility === 'private' && !isMember) {
    throw new Forbidden('private_room');
  }

  return { user, room, isOwner, isMember };
}

/** 供 WS 握手等只需"能不能进这个房间"的场景复用的轻量判定。 */
export async function isRoomParticipant(userId: string, roomId: string): Promise<boolean> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { ownerId: true, visibility: true },
  });
  if (!room) return false;
  if (room.ownerId === userId) return true;
  const membership = await prisma.membership.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { status: true },
  });
  return membership?.status === 'approved';
}
