import { FastifyPluginAsync } from 'fastify';
import { prisma } from '@tianma/database';
import { Forbidden, NotFound, authedUser, roomAccess } from '../auth/guards';
import { roomGateway } from '../ws/room-gateway';

const GAME_CONFIGS = {
  werewolf: { min: 6, max: 12, label: '狼人杀' },
  murder_mystery: { min: 4, max: 8, label: '剧本杀' },
  who_is_the_thief: { min: 4, max: 10, label: '谁是凶手' },
};

export const entertainmentPlugin: FastifyPluginAsync = async (fastify) => {
  /** 娱乐房间列表 */
  fastify.get('/rooms', async (request) => {
    const user = authedUser(request);
    const rooms = await prisma.room.findMany({
      where: {
        type: 'entertainment',
        status: { not: 'archived' },
        OR: [
          { ownerId: user.id },
          { visibility: 'public' },
          { gamePlayers: { some: { userId: user.id } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        owner: { select: { id: true, displayName: true } },
        gamePlayers: { select: { id: true, role: true, nickname: true } },
        _count: { select: { gamePlayers: true } },
      },
    });
    return rooms;
  });

  /** 创建游戏房间 */
  fastify.post('/rooms', async (request, reply) => {
    const user = authedUser(request);
    const body = request.body as {
      title: string;
      description?: string;
      gameType: keyof typeof GAME_CONFIGS;
      minPlayers?: number;
      maxPlayers?: number;
      visibility?: 'public' | 'private';
    };
    const config = GAME_CONFIGS[body.gameType];
    if (!config) return reply.status(400).send({ error: 'invalid_game_type' });

    const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { displayName: true } });

    const room = await prisma.room.create({
      data: {
        title: body.title,
        description: body.description ?? '',
        type: 'entertainment',
        mode: 'free',
        status: 'idle',
        visibility: body.visibility ?? 'public',
        gameType: body.gameType,
        gameStatus: 'waiting',
        minPlayers: body.minPlayers ?? config.min,
        maxPlayers: body.maxPlayers ?? config.max,
        ownerId: user.id,
      },
    });

    // 房主自动成为第一个玩家
    await prisma.gamePlayer.create({
      data: {
        roomId: room.id,
        userId: user.id,
        nickname: dbUser?.displayName ?? '房主',
        role: 'human',
      },
    });

    return reply.status(201).send(room);
  });

  /** 房间详情 */
  fastify.get('/rooms/:roomId', async (request) => {
    const { roomId } = request.params as { roomId: string };
    const room = await prisma.room.findFirst({
      where: { id: roomId, type: 'entertainment' },
      include: {
        owner: { select: { id: true, displayName: true } },
        gamePlayers: {
          include: {
            user: { select: { id: true, displayName: true, avatarColor: true } },
            profile: { select: { id: true, name: true, avatarColor: true } },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!room) throw new NotFound('room_not_found');
    return room;
  });

  /** 加入游戏 */
  fastify.post('/rooms/:roomId/join', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const user = authedUser(request);

    const room = await prisma.room.findFirst({ where: { id: roomId, type: 'entertainment' } });
    if (!room) return reply.status(404).send({ error: 'room_not_found' });
    if (room.gameStatus !== 'waiting') return reply.status(400).send({ error: 'game_not_waiting' });

    const count = await prisma.gamePlayer.count({ where: { roomId } });
    if (room.maxPlayers && count >= room.maxPlayers) return reply.status(400).send({ error: 'room_full' });

    const existing = await prisma.gamePlayer.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
    });
    if (existing) return reply.status(200).send(existing);

    const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { displayName: true } });
    const player = await prisma.gamePlayer.create({
      data: { roomId, userId: user.id, nickname: dbUser?.displayName ?? '玩家', role: 'human' },
    });

    await maybeReady(roomId);
    roomGateway.broadcast(roomId, { type: 'game_player_joined', payload: { player } });

    return reply.status(201).send(player);
  });

  /** 离开游戏 */
  fastify.post('/rooms/:roomId/leave', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const user = authedUser(request);

    const player = await prisma.gamePlayer.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
    });
    if (!player) return reply.status(404).send({ error: 'not_in_room' });

    await prisma.gamePlayer.delete({ where: { id: player.id } });
    roomGateway.broadcast(roomId, { type: 'game_player_left', payload: { playerId: player.id } });

    return reply.status(204).send();
  });

  /** 邀请用户 */
  fastify.post('/rooms/:roomId/invite', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const access = await roomAccess(request, roomId, 'owner');
    const { email } = request.body as { email: string };

    const target = await prisma.user.findUnique({ where: { email }, select: { id: true, displayName: true } });
    if (!target) return reply.status(404).send({ error: 'user_not_found' });

    const room = await prisma.room.findFirst({ where: { id: roomId, type: 'entertainment' } });
    if (!room) return reply.status(404).send({ error: 'room_not_found' });

    const count = await prisma.gamePlayer.count({ where: { roomId } });
    if (room.maxPlayers && count >= room.maxPlayers) return reply.status(400).send({ error: 'room_full' });

    const existing = await prisma.gamePlayer.findUnique({
      where: { roomId_userId: { roomId, userId: target.id } },
    });
    if (existing) return reply.status(200).send(existing);

    const player = await prisma.gamePlayer.create({
      data: { roomId, userId: target.id, nickname: target.displayName, role: 'human' },
    });

    await maybeReady(roomId);
    roomGateway.broadcast(roomId, { type: 'game_player_joined', payload: { player } });

    return reply.status(201).send(player);
  });

  /** 添加 AI 玩家 */
  fastify.post('/rooms/:roomId/ai', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const access = await roomAccess(request, roomId, 'owner');
    const body = request.body as { profileId?: string; nickname?: string };

    const room = await prisma.room.findFirst({ where: { id: roomId, type: 'entertainment' } });
    if (!room) return reply.status(404).send({ error: 'room_not_found' });

    const count = await prisma.gamePlayer.count({ where: { roomId } });
    if (room.maxPlayers && count >= room.maxPlayers) return reply.status(400).send({ error: 'room_full' });

    let nickname = body.nickname ?? 'AI 玩家';
    let profileId = body.profileId ?? null;

    if (profileId) {
      const profile = await prisma.agentProfile.findUnique({ where: { id: profileId } });
      if (profile) {
        nickname = body.nickname ?? profile.name;
        profileId = profile.id;
      }
    }

    const player = await prisma.gamePlayer.create({
      data: { roomId, profileId, nickname, role: 'ai' },
    });

    await maybeReady(roomId);
    roomGateway.broadcast(roomId, { type: 'game_player_joined', payload: { player } });

    return reply.status(201).send(player);
  });

  /** 开始游戏 */
  fastify.post('/rooms/:roomId/start', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const access = await roomAccess(request, roomId, 'owner');

    const room = await prisma.room.findFirst({
      where: { id: roomId, type: 'entertainment' },
      include: { gamePlayers: true },
    });
    if (!room) return reply.status(404).send({ error: 'room_not_found' });
    if (room.gameStatus !== 'waiting' && room.gameStatus !== 'ready') {
      return reply.status(400).send({ error: 'game_cannot_start' });
    }

    const playerCount = room.gamePlayers.length;
    if (room.minPlayers && playerCount < room.minPlayers) {
      return reply.status(400).send({ error: 'not_enough_players' });
    }

    // 初始化游戏状态
    const gameState = await initGameState(room.gameType, room.gamePlayers);

    await prisma.room.update({
      where: { id: roomId },
      data: { gameStatus: 'playing', gameState },
    });

    roomGateway.broadcast(roomId, { type: 'game_started', payload: { gameState } });

    return reply.status(200).send({ gameStatus: 'playing', gameState });
  });

  /** 获取游戏状态 */
  fastify.get('/rooms/:roomId/state', async (request) => {
    const { roomId } = request.params as { roomId: string };
    const room = await prisma.room.findFirst({
      where: { id: roomId, type: 'entertainment' },
      select: { gameStatus: true, gameState: true, gameType: true },
    });
    if (!room) throw new NotFound('room_not_found');
    return room;
  });

  /** 游戏动作（投票、发言等） */
  fastify.post('/rooms/:roomId/action', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const user = authedUser(request);
    const body = request.body as { type: string; targetId?: string; content?: string };

    const room = await prisma.room.findFirst({ where: { id: roomId, type: 'entertainment' } });
    if (!room) return reply.status(404).send({ error: 'room_not_found' });
    if (room.gameStatus !== 'playing') return reply.status(400).send({ error: 'game_not_playing' });

    // TODO: 根据游戏类型处理动作
    roomGateway.broadcast(roomId, {
      type: 'game_action',
      payload: { playerId: user.id, action: body },
    });

    return { ok: true };
  });
};

/** 检查是否人数已满，更新为 ready 状态 */
async function maybeReady(roomId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { _count: { select: { gamePlayers: true } } },
  });
  if (!room || !room.maxPlayers) return;
  if (room._count.gamePlayers >= room.maxPlayers) {
    await prisma.room.update({ where: { id: roomId }, data: { gameStatus: 'ready' } });
  }
}

/** 初始化游戏状态 */
async function initGameState(gameType: string | null, players: { id: string; role: 'human' | 'ai'; nickname: string }[]) {
  if (gameType === 'werewolf') {
    return initWerewolfState(players);
  }
  return { players: players.map((p) => ({ ...p, isAlive: true })) };
}

/** 初始化狼人杀状态 */
function initWerewolfState(players: { id: string; role: 'human' | 'ai'; nickname: string }[]) {
  const count = players.length;
  // 狼人数量：6-8人2狼，9-11人3狼，12人4狼
  const wolfCount = count <= 8 ? 2 : count <= 11 ? 3 : 4;
  const specialCount = Math.floor(count / 3); // 预言家、女巫、猎人等

  // 随机分配角色
  const roles = [...players];
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  const assignments = roles.map((p, index) => {
    let gameRole = 'villager';
    if (index < wolfCount) gameRole = 'werewolf';
    else if (index < wolfCount + 1) gameRole = 'seer';
    else if (index < wolfCount + 2) gameRole = 'witch';
    else if (index < wolfCount + 3) gameRole = 'hunter';

    return {
      playerId: p.id,
      nickname: p.nickname,
      playerRole: p.role,
      gameRole,
      isAlive: true,
    };
  });

  return {
    phase: 'night', // night -> day -> vote -> night
    round: 1,
    assignments,
    votes: {},
    actions: [],
  };
}
