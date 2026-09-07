import { FastifyPluginAsync } from 'fastify';
import { prisma } from '@tianma/database';
import { Prisma } from '@prisma/client';
import { validatePolicyDraft } from '@tianma/ai-core';
import { ModeratorPolicySchema, PublishPolicyInputSchema } from '@tianma/contracts';
import { Conflict, roomAccess } from '../auth/guards';

const POLICY_SELECT = {
  id: true,
  roomId: true,
  version: true,
  rules: true,
  ladder: true,
  publishedAt: true,
  createdBy: true,
} as const;

/**
 * AI 管理员策略（flows §3）。
 *
 * 发布即产生 version+1 的新行，旧版本永不修改也不删除 —— 治理事件按 policyVersion
 * 引用它，改了就等于篡改历史审计依据（验收 #2 要求事件显示"规则版本"）。
 */
export const policyPlugin: FastifyPluginAsync = async (fastify) => {
  /** 侧栏要显示"规则摘要 + 当前版本号"，所以成员可读。 */
  fastify.get('/rooms/:roomId/policy', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    await roomAccess(request, roomId, 'member');
    const policy = await prisma.moderatorPolicy.findFirst({
      where: { roomId },
      orderBy: { version: 'desc' },
      select: POLICY_SELECT,
    });
    if (!policy) return reply.status(404).send({ error: 'no_policy_published' });
    return ModeratorPolicySchema.parse(policy);
  });

  /** 历史版本只列给房主：普通成员需要知道"当时按哪版处置的"，但不需要版本管理能力。 */
  fastify.get('/rooms/:roomId/policies', async (request) => {
    const { roomId } = request.params as { roomId: string };
    await roomAccess(request, roomId, 'owner');
    const policies = await prisma.moderatorPolicy.findMany({
      where: { roomId },
      orderBy: { version: 'desc' },
      select: { version: true, publishedAt: true, createdBy: true, rules: true, ladder: true },
    });
    return policies.map((policy) => ({
      ...policy,
      ruleCount: Array.isArray(policy.rules) ? policy.rules.length : 0,
    }));
  });

  fastify.post('/rooms/:roomId/policy', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const access = await roomAccess(request, roomId, 'owner');
    const parsed = PublishPolicyInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }

    // 语义校验：形状合法但缺触发条件 / 阶梯乱序 / 规则带撤销权，都要挡下来
    const validation = validatePolicyDraft(parsed.data.rules, parsed.data.ladder);
    if (!validation.ok) {
      return reply.status(400).send({ error: 'policy_invalid', issues: validation.issues });
    }

    const latest = await prisma.moderatorPolicy.findFirst({
      where: { roomId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;

    try {
      const policy = await prisma.moderatorPolicy.create({
        data: {
          roomId,
          version,
          rules: parsed.data.rules,
          ladder: parsed.data.ladder,
          createdBy: access.user.id,
        },
        select: POLICY_SELECT,
      });

      // 有策略才谈得上启用：保持 moderatorEnabled 与"确实发布过规则"一致
      if (!access.room.moderatorEnabled) {
        await prisma.room.update({ where: { id: roomId }, data: { moderatorEnabled: true } });
      }

      return reply.status(201).send(ModeratorPolicySchema.parse(policy));
    } catch (error) {
      // 并发发布撞到 @@unique([roomId, version])：让调用方重读最新版本再提交，
      // 而不是悄悄改成 version+1 —— 那会让两个房主的编辑互相吞掉规则。
      // 其余异常必须原样抛出，不能被翻译成语义冲突而掩盖真实故障。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new Conflict('policy_version_conflict');
      }
      throw error;
    }
  });
};
