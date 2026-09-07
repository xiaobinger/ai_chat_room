import { FastifyPluginAsync } from 'fastify';
import {
  InviteInputSchema,
  JoinRequestInputSchema,
  MembershipApproveInputSchema,
  MembershipNicknameInputSchema,
  PublicUserSchema,
} from '@tianma/contracts';
import { prisma } from '@tianma/database';
import { Conflict, Forbidden, NotFound, authedUser, roomAccess } from '../auth/guards';

const MEMBER_INCLUDE = {
  user: { select: { id: true, displayName: true, avatarColor: true, createdAt: true } },
  role: { select: { id: true, name: true, type: true } },
} as const;

/**
 * 成员与入房审批（mvp-spec §3.1：必须经房主批准）。
 *
 * 修复前两件事同时坏掉：路径写成 `/rooms/:roomId/...` 却挂在 `/api/v1/rooms` 前缀下
 * （实际路由是 `/api/v1/rooms/rooms/:roomId/...`），且 `approverId` 取自请求体 ——
 * 任何登录用户都能把自己批准成成员。现在本插件挂在 `/api/v1`，审批人只来自 JWT。
 */
export const membershipsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/rooms/:roomId/memberships', async (request) => {
    const { roomId } = request.params as { roomId: string };
    await roomAccess(request, roomId, 'member');
    const rows = await prisma.membership.findMany({
      where: { roomId },
      orderBy: { joinedAt: 'asc' },
      include: MEMBER_INCLUDE,
    });
    return rows.map((row) => ({ ...row, user: PublicUserSchema.parse(row.user) }));
  });

  /** 自助申请：落一条 invited 等房主审批。房主本人天然就是成员。 */
  fastify.post('/rooms/:roomId/join', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const user = authedUser(request);
    const parsed = JoinRequestInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { ownerId: true },
    });
    if (!room) return reply.status(404).send({ error: 'room_not_found' });
    if (room.ownerId === user.id) return reply.status(200).send({ status: 'approved' });

    const existing = await prisma.membership.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
      select: { status: true },
    });
    if (existing?.status === 'approved') return reply.status(200).send({ status: 'approved' });
    if (existing?.status === 'invited') return reply.status(202).send({ status: 'invited' });
    if (existing?.status === 'rejected') throw new Conflict('join_request_rejected');

    const membership = await prisma.membership.create({
      data: { roomId, userId: user.id, status: 'invited', intent: parsed.data.intent },
      select: { id: true, status: true, intent: true },
    });
    return reply.status(201).send(membership);
  });

  /** 房主主动邀请：提供被邀请人 email，直接创建 invited 记录。 */
  fastify.post('/rooms/:roomId/invite', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const access = await roomAccess(request, roomId, 'owner');
    const parsed = InviteInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }

    const target = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true },
    });
    if (!target) return reply.status(404).send({ error: 'user_not_found' });
    if (target.id === access.user.id) return reply.status(400).send({ error: 'cannot_invite_self' });

    const existing = await prisma.membership.findUnique({
      where: { roomId_userId: { roomId, userId: target.id } },
      select: { status: true },
    });
    if (existing?.status === 'approved') return reply.status(200).send({ status: 'approved' });
    if (existing?.status === 'invited') return reply.status(200).send({ status: 'invited' });

    const membership = await prisma.membership.create({
      data: { roomId, userId: target.id, status: 'invited', intent: 'discuss' },
      select: { id: true, status: true, intent: true },
    });
    return reply.status(201).send(membership);
  });

  fastify.post('/rooms/:roomId/memberships/:membershipId/approve', async (request, reply) => {
    const { roomId, membershipId } = request.params as { roomId: string; membershipId: string };
    const access = await roomAccess(request, roomId, 'owner');
    const parsed = MembershipApproveInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }

    const membership = await prisma.membership.findFirst({
      where: { id: membershipId, roomId },
      select: { id: true },
    });
    if (!membership) return reply.status(404).send({ error: 'membership_not_found' });

    // 审批时可以顺带绑定角色，但角色必须属于这个房间
    if (parsed.data.roleId) {
      const role = await prisma.roomRole.findFirst({
        where: { id: parsed.data.roleId, roomId },
        select: { id: true },
      });
      if (!role) return reply.status(400).send({ error: 'role_not_in_room' });
    }

    const updated = await prisma.membership.update({
      where: { id: membership.id },
      data: {
        status: 'approved',
        joinedAt: new Date(),
        ...(parsed.data.roleId ? { roleId: parsed.data.roleId } : {}),
      },
      include: MEMBER_INCLUDE,
    });
    return {
      ...updated,
      user: PublicUserSchema.parse(updated.user),
      approvedBy: access.user.id,
    };
  });

  fastify.post('/rooms/:roomId/memberships/:membershipId/reject', async (request, reply) => {
    const { roomId, membershipId } = request.params as { roomId: string; membershipId: string };
    const access = await roomAccess(request, roomId, 'owner');

    const membership = await prisma.membership.findFirst({
      where: { id: membershipId, roomId },
      select: { id: true, userId: true },
    });
    if (!membership) return reply.status(404).send({ error: 'membership_not_found' });
    if (membership.userId === access.room.ownerId) throw new Forbidden('cannot_reject_owner');

    return prisma.membership.update({
      where: { id: membership.id },
      data: { status: 'rejected', leftAt: new Date() },
    });
  });

  /** 设置/修改面具昵称：成员在房间内的显示名。 */
  fastify.patch('/rooms/:roomId/membership/nickname', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const user = authedUser(request);
    const parsed = MembershipNicknameInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }

    const membership = await prisma.membership.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
      select: { id: true },
    });
    if (!membership) return reply.status(404).send({ error: 'membership_not_found' });

    const updated = await prisma.membership.update({
      where: { id: membership.id },
      data: { nickname: parsed.data.nickname || null },
      select: { id: true, nickname: true },
    });
    return updated;
  });

  /** 自己退出。房主不能"退出"自己的房间，只能归档。 */
  fastify.delete('/rooms/:roomId/membership', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const user = authedUser(request);
    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { ownerId: true } });
    if (!room) return reply.status(404).send({ error: 'room_not_found' });
    if (room.ownerId === user.id) throw new Forbidden('owner_cannot_leave');

    const membership = await prisma.membership.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
      select: { id: true },
    });
    if (!membership) throw new NotFound('membership_not_found');

    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: 'left', leftAt: new Date() },
    });
    return reply.status(204).send();
  });
};
