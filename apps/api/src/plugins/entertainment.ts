import { FastifyPluginAsync } from 'fastify';
import { prisma } from '@tianma/database';
import { Forbidden, NotFound, authedUser, roomAccess } from '../auth/guards';
import { roomGateway } from '../ws/room-gateway';
import { WerewolfGameRunner, type GamePlayerInfo } from '../../../ai-worker/src/game/game-runner';

const GAME_CONFIGS = {
  werewolf: { min: 6, max: 12, label: '狼人杀' },
  murder_mystery: { min: 4, max: 8, label: '剧本杀' },
  who_is_the_thief: { min: 4, max: 10, label: '谁是凶手' },
};

/** 活跃游戏实例 */
const activeGames = new Map<string, WerewolfGameRunner>();

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
    await roomAccess(request, roomId, 'owner');

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

    // 创建游戏运行器
    const players: GamePlayerInfo[] = room.gamePlayers.map((p) => ({
      playerId: p.id,
      nickname: p.nickname,
      isAi: p.role === 'ai',
    }));

    const runner = new WerewolfGameRunner(players);
    activeGames.set(roomId, runner);

    // 监听游戏事件并广播
    runner.onEvent((event) => {
      roomGateway.broadcast(roomId, { type: `game_${event.type}`, payload: event.payload });
    });

    // 初始化游戏状态
    const gameState = runner.getState();
    await prisma.room.update({
      where: { id: roomId },
      data: { gameStatus: 'playing', gameState: gameState as object },
    });

    // 广播游戏开始
    roomGateway.broadcast(roomId, {
      type: 'game_started',
      payload: { gameState: gameState as unknown as Record<string, unknown>, players: room.gamePlayers.map((p) => ({ id: p.id, nickname: p.nickname, role: p.role })) },
    });

    // 如果是狼人杀，自动开始夜晚
    if (room.gameType === 'werewolf') {
      setTimeout(() => void processNightPhase(roomId), 1000);
    }

    return reply.status(200).send({ gameStatus: 'playing', gameState });
  });

  /** 获取游戏状态 */
  fastify.get('/rooms/:roomId/state', async (request) => {
    const { roomId } = request.params as { roomId: string };
    const runner = activeGames.get(roomId);
    if (runner) {
      return runner.getState();
    }
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

    const runner = activeGames.get(roomId);
    if (!runner) return reply.status(400).send({ error: 'game_not_active' });

    const membership = await prisma.gamePlayer.findFirst({
      where: { roomId, userId: user.id },
    });
    if (!membership) return reply.status(403).send({ error: 'not_a_player' });

    // 处理玩家动作
    runner.handlePlayerAction({
      type: body.type as never,
      playerId: membership.id,
      targetId: body.targetId,
      content: body.content,
    });

    // 更新数据库状态
    await prisma.room.update({
      where: { id: roomId },
      data: { gameState: runner.getState() as object },
    });

    return { ok: true, state: runner.getState() };
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

/** 处理夜晚阶段 */
async function processNightPhase(roomId: string) {
  const runner = activeGames.get(roomId);
  if (!runner) return;

  await runner.processNightActions();

  // 更新数据库
  await prisma.room.update({
    where: { id: roomId },
    data: { gameState: runner.getState() as object },
  });

  // 检查游戏是否结束
  const state = runner.getState();
  if (state.phase === 'finished') {
    await prisma.room.update({ where: { id: roomId }, data: { gameStatus: 'finished' } });
    activeGames.delete(roomId);
    return;
  }

  // 进入白天发言阶段
  setTimeout(() => void processDayPhase(roomId), 1000);
}

/** 处理白天阶段 */
async function processDayPhase(roomId: string) {
  const runner = activeGames.get(roomId);
  if (!runner) return;

  await runner.processDaySpeeches();

  // 更新数据库
  await prisma.room.update({
    where: { id: roomId },
    data: { gameState: runner.getState() as object },
  });

  // AI 投票
  await runner.processAiVotes();

  // 结算投票
  runner.resolveVotes();

  // 更新数据库
  await prisma.room.update({
    where: { id: roomId },
    data: { gameState: runner.getState() as object },
  });

  // 检查游戏是否结束
  const state = runner.getState();
  if (state.phase === 'finished') {
    await prisma.room.update({ where: { id: roomId }, data: { gameStatus: 'finished' } });
    activeGames.delete(roomId);
    return;
  }

  // 进入下一轮夜晚
  setTimeout(() => void processNightPhase(roomId), 2000);
}
