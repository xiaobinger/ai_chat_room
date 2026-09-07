import { FastifyPluginAsync } from 'fastify';
import { AgentProfileSchema, CreateProfileInputSchema } from '@tianma/contracts';
import { prisma } from '@tianma/database';
import { NotFound, authedUser } from '../auth/guards';

/**
 * 角色工坊（mvp-spec §3.2「从内置角色库添加角色」）。
 *
 * 只暴露内置模板与本人创建的模板：ownerId 为 null 即系统内置，所有人可见。
 * 别人的自定义模板不出现在列表里，也不允许凭 id 挂到房间里。
 */
export const profilesPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/profiles', async (request) => {
    const user = authedUser(request);
    const profiles = await prisma.agentProfile.findMany({
      where: { OR: [{ isBuiltIn: true }, { ownerId: user.id }] },
      orderBy: [{ isBuiltIn: 'desc' }, { createdAt: 'asc' }],
    });
    return profiles.map((profile) => AgentProfileSchema.parse(profile));
  });

  fastify.post('/profiles', async (request, reply) => {
    const user = authedUser(request);
    const parsed = CreateProfileInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }

    const created = await prisma.agentProfile.create({
      data: {
        name: parsed.data.name,
        systemPrompt: parsed.data.systemPrompt,
        tagline: parsed.data.tagline ?? '',
        description: parsed.data.description ?? '',
        avatarColor: parsed.data.avatarColor ?? '#7457ff',
        rationality: parsed.data.rationality ?? 50,
        aggressiveness: parsed.data.aggressiveness ?? 50,
        ownerId: user.id,
        isBuiltIn: false,
      },
    });
    return reply.status(201).send(AgentProfileSchema.parse(created));
  });

  /** 删除自己的模板。内置模板删不掉 —— 它是别人房间的来源。 */
  fastify.delete('/profiles/:profileId', async (request, reply) => {
    const user = authedUser(request);
    const { profileId } = request.params as { profileId: string };

    const profile = await prisma.agentProfile.findFirst({
      where: { id: profileId, ownerId: user.id, isBuiltIn: false },
      select: { id: true },
    });
    if (!profile) throw new NotFound('profile_not_found');

    await prisma.agentProfile.delete({ where: { id: profile.id } });
    return reply.status(204).send();
  });
};
