import { FastifyPluginAsync } from 'fastify';
import {
  appendRoomMessage,
  prisma,
} from '@tianma/database';
import {
  CreateRoleInputSchema,
  CreateRoomInputSchema,
  DEFAULT_RUN_SETTINGS,
  MessageSchema,
  PublicUserSchema,
  RoomRoleSchema,
  RoomSchema,
  SendMessageInputSchema,
  StartRunInputSchema,
  UpdateRoomInputSchema,
} from '@tianma/contracts';
import { roomAccess, authedUser, Forbidden } from '../auth/guards';
import { roomGateway } from '../ws/room-gateway';
import { messageEvent } from '../lib/events';
import { runQueue } from '../queue';

const ROOM_LIST_ITEM = {
  id: true,
  title: true,
  description: true,
  mode: true,
  status: true,
  visibility: true,
  language: true,
  ownerId: true,
  messageSeq: true,
  moderatorEnabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ROLE_FIELDS = {
  id: true,
  roomId: true,
  profileId: true,
  name: true,
  type: true,
  systemPrompt: true,
  color: true,
  modelName: true,
  stance: true,
  aggressiveness: true,
  priority: true,
  createdAt: true,
} as const;

export const roomsPlugin: FastifyPluginAsync = async (fastify) => {
  /** 大厅：我拥有的 + 我已加入的 + 公开房间。 */
  fastify.get('/', async (request) => {
    const user = authedUser(request);
    const rooms = await prisma.room.findMany({
      where: {
        status: { not: 'archived' },
        OR: [{ ownerId: user.id }, { visibility: 'public' }, { memberships: { some: { userId: user.id, status: 'approved' } } }],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        ...ROOM_LIST_ITEM,
        owner: { select: { id: true, displayName: true, avatarColor: true, createdAt: true } },
        roomRoles: { select: { id: true, name: true, type: true, color: true }, orderBy: { createdAt: 'asc' } },
        _count: { select: { messages: true, runs: true, memberships: true } },
      },
    });
    return rooms.map((room) => ({
      ...room,
      owner: PublicUserSchema.parse(room.owner),
    }));
  });

  fastify.post('/', async (request, reply) => {
    const parsed = CreateRoomInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }
    const user = authedUser(request);

    // 房主天然是一条 approved 成员关系，否则每个 requireRoomMember 都要特判 ownerId
    const room = await prisma.$transaction(async (tx) => {
      const created = await tx.room.create({
        data: {
          ...parsed.data,
          ownerId: user.id,
          status: 'idle',
        },
        select: ROOM_LIST_ITEM,
      });
      await tx.membership.create({
        data: { roomId: created.id, userId: user.id, status: 'approved', intent: 'discuss', joinedAt: new Date() },
      });
      return created;
    });

    return reply.status(201).send(RoomSchema.parse(room));
  });

  fastify.get('/:roomId', async (request) => {
    const { roomId } = request.params as { roomId: string };
    const access = await roomAccess(request, roomId, 'read');

    const room = await prisma.room.findUniqueOrThrow({
      where: { id: access.room.id },
      select: {
        ...ROOM_LIST_ITEM,
        membersCanChat: true,
        membersCanModifyTopic: true,
        membersCanAddRoles: true,
        membersCanStartRun: true,
        owner: { select: { id: true, displayName: true, avatarColor: true, createdAt: true } },
        roomRoles: { select: ROLE_FIELDS, orderBy: { createdAt: 'asc' } },
        memberships: {
          where: { status: { in: ['invited', 'approved'] } },
          include: {
            user: { select: { id: true, displayName: true, avatarColor: true, createdAt: true } },
            role: { select: { id: true, name: true } },
          },
        },
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, status: true, topic: true, currentRound: true, createdAt: true, terminationReason: true },
        },
      },
    });

    // RoomSchema 只描述房间自身的列，zod 会剥掉它没声明的键。
    // 所以必须先拆出关联字段各自校验，不能把整个含关联的结果直接丢给 RoomSchema.parse
    const { roomRoles, memberships, runs, owner, ...columns } = room;
    return {
      ...RoomSchema.parse(columns),
      owner: PublicUserSchema.parse(owner),
      roomRoles: roomRoles.map((role) => RoomRoleSchema.parse(role)),
      runs,
      isOwner: access.isOwner,
      isMember: access.isMember,
      online: roomGateway.onlineCount(room.id),
      // 公开房间非成员可浏览，但成员花名册只给成员看
      members: access.isMember
        ? memberships.map((membership) => ({
            ...membership,
            user: PublicUserSchema.parse(membership.user),
          }))
        : [],
    };
  });

  fastify.patch('/:roomId', async (request) => {
    const { roomId } = request.params as { roomId: string };
    await roomAccess(request, roomId, 'owner');
    const parsed = UpdateRoomInputSchema.safeParse(request.body);
    if (!parsed.success) throw parsed.error;

    const updated = await prisma.room.update({ where: { id: roomId }, data: parsed.data, select: ROOM_LIST_ITEM });
    return RoomSchema.parse(updated);
  });

  fastify.get('/:roomId/roles', async (request) => {
    const { roomId } = request.params as { roomId: string };
    await roomAccess(request, roomId, 'member');
    const roles = await prisma.roomRole.findMany({ where: { roomId }, select: ROLE_FIELDS, orderBy: { createdAt: 'asc' } });
    return roles.map((role) => RoomRoleSchema.parse(role));
  });

  fastify.post('/:roomId/roles', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const access = await roomAccess(request, roomId, 'member');
    if (!access.isOwner && !access.room.membersCanAddRoles) throw new Forbidden('members_cannot_add_roles');

    const parsed = CreateRoleInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }

    if (parsed.data.profileId) {
      const profile = await prisma.agentProfile.findFirst({
        where: { id: parsed.data.profileId, OR: [{ isBuiltIn: true }, { ownerId: access.user.id }] },
        select: { id: true },
      });
      if (!profile) return reply.status(400).send({ error: 'profile_not_available' });
    }

    const role = await prisma.roomRole.create({ data: { roomId, ...parsed.data }, select: ROLE_FIELDS });

    roomGateway.broadcast(roomId, { type: 'role_created', payload: RoomRoleSchema.parse(role) });
    return reply.status(201).send(RoomRoleSchema.parse(role));
  });

  fastify.delete('/:roomId/roles/:roleId', async (request, reply) => {
    const { roomId, roleId } = request.params as { roomId: string; roleId: string };
    await roomAccess(request, roomId, 'owner');

    const role = await prisma.roomRole.findFirst({ where: { id: roleId, roomId }, select: { id: true } });
    if (!role) return reply.status(404).send({ error: 'role_not_found' });

    await prisma.roomRole.delete({ where: { id: role.id } });
    return reply.status(204).send();
  });

  /**
   * 断线回补：客户端带 `?after=<已收到的最大 sequence>` 拉取缺失区间。
   * 这是验收 #6 的落点 —— Pub/Sub 丢一条也能靠它补齐。
   */
  fastify.get('/:roomId/messages', async (request) => {
    const { roomId } = request.params as { roomId: string };
    await roomAccess(request, roomId, 'member');
    const query = request.query as { after?: string; limit?: string };
    const after = Number.parseInt(query.after ?? '0', 10);
    const limit = Math.min(200, Math.max(1, Number.parseInt(query.limit ?? '100', 10) || 100));

    const rows = await prisma.message.findMany({
      where: { roomId, sequence: { gt: Number.isFinite(after) ? after : 0 } },
      orderBy: { sequence: 'asc' },
      take: limit,
      include: { role: { select: { id: true, name: true, color: true } } },
    });
    return rows.map((row) => MessageSchema.parse({ ...row, role: row.role ?? undefined }));
  });

  /** 人类成员发言。身份一律来自 JWT，不接受请求体里的 senderType / senderId。 */
  fastify.post('/:roomId/messages', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const access = await roomAccess(request, roomId, 'member');
    if (!access.isOwner && !access.room.membersCanChat) {
      return reply.status(403).send({ error: 'members_cannot_chat' });
    }
    const parsed = SendMessageInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }

    if (parsed.data.runId) {
      const run = await prisma.discussionRun.findFirst({ where: { id: parsed.data.runId, roomId }, select: { id: true } });
      if (!run) return reply.status(400).send({ error: 'run_not_in_room' });
    }

    const created = await appendRoomMessage(prisma, {
      roomId,
      runId: parsed.data.runId ?? null,
      senderType: 'user',
      senderId: access.user.id,
      content: parsed.data.content,
      status: 'completed',
    });

    const event = await messageEvent(created.id);
    if (event) roomGateway.broadcast(roomId, event);
    return reply.status(201).send(created);
  });

  /** 五步向导的确认页把"建房 + 配角色 + 启动"合成一次提交。 */
  fastify.post('/:roomId/start', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const access = await roomAccess(request, roomId, 'member');
    if (!access.isOwner && !access.room.membersCanStartRun) {
      return reply.status(403).send({ error: 'members_cannot_start' });
    }
    const speakable = await prisma.roomRole.count({ where: { roomId } });
    if (speakable === 0) return reply.status(400).send({ error: 'no_speakable_agent' });

    const parsed = StartRunInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }

    const run = await prisma.discussionRun.create({
      data: {
        roomId,
        topic: parsed.data.topic,
        goal: parsed.data.goal ?? '',
        completionCriteria: parsed.data.completionCriteria ?? '',
        status: 'queued',
        settings: { ...DEFAULT_RUN_SETTINGS, ...(parsed.data.settings ?? {}) },
        createdBy: access.user.id,
      },
    });

    await prisma.room.update({ where: { id: roomId }, data: { status: 'running' } });
    await runQueue.add('run', { runId: run.id, action: 'run' }, { jobId: `run:${run.id}:start` });

    return reply.status(201).send(run);
  });
};
