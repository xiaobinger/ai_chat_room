import { FastifyPluginAsync } from 'fastify';
import { LoginInputSchema, PublicUserSchema, RegisterInputSchema, type PublicUser } from '@tianma/contracts';
import { prisma } from '@tianma/database';
import { Prisma } from '@prisma/client';
import { hashPassword, verifyPassword } from '../auth/passwords';
import { signToken } from '../auth/tokens';
import { Conflict, Unauthorized, authedUser } from '../auth/guards';

/** 用户不存在时也要跑一次 bcrypt，否则响应时间差本身就是一份用户名枚举清单。 */
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8lPMPfVSZmVYB0PmTLmHOEPqmLxPGq';

const USER_FIELDS = {
  id: true,
  email: true,
  displayName: true,
  avatarColor: true,
  createdAt: true,
} as const;

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: PublicUser;
}

async function issue(user: {
  id: string;
  email: string;
  displayName: string;
  avatarColor: string | null;
  createdAt: Date;
}): Promise<AuthResponse> {
  const { token, expiresAt } = signToken({ id: user.id, email: user.email });
  return {
    token,
    expiresAt: expiresAt.toISOString(),
    // 过一遍契约，确保 passwordHash 这类字段不可能被顺手带出去
    user: PublicUserSchema.parse(user),
  };
}

export const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/register', async (request, reply) => {
    const parsed = RegisterInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }
    const { email, password, displayName } = parsed.data;

    try {
      const created = await prisma.user.create({
        data: { email: email.toLowerCase(), passwordHash: await hashPassword(password), displayName },
        select: USER_FIELDS,
      });
      return reply.status(201).send(await issue(created));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new Conflict('email_already_registered');
      }
      throw error;
    }
  });

  fastify.post('/login', async (request) => {
    const parsed = LoginInputSchema.safeParse(request.body);
    if (!parsed.success) throw new Unauthorized('invalid_credentials');
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { ...USER_FIELDS, passwordHash: true },
    });
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new Unauthorized('invalid_credentials');

    return issue(user);
  });

  fastify.get('/me', async (request) => {
    const auth = authedUser(request);
    const user = await prisma.user.findUnique({ where: { id: auth.id }, select: USER_FIELDS });
    if (!user) throw new Unauthorized();
    // /me 是唯一能看到自己邮箱的地方
    return { ...PublicUserSchema.parse(user), email: user.email };
  });
};
