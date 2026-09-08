import { FastifyPluginAsync } from 'fastify';
import { prisma, Prisma } from '@tianma/database';
import { NotFound, authedUser, roomAccess } from '../auth/guards';
import { roomGateway } from '../ws/room-gateway';
import { GameDirector, type GameTypeStr } from '../game/game-director';
import { GameError } from '../../../ai-worker/src/game/errors';

interface GameActionBody {
  type: string;
  targetId?: string;
  content?: string;
  clueId?: string;
}

const GAME_CONFIGS: Record<GameTypeStr, { min: number; max: number; label: string }> = {
  werewolf: { min: 6, max: 12, label: '狼人杀' },
  murder_mystery: { min: 4, max: 8, label: '剧本杀' },
  who_is_the_thief: { min: 4, max: 10, label: '谁是凶手' },
  who_is_undercover: { min: 4, max: 12, label: '谁是卧底' },
};

function isGameType(value: unknown): value is GameTypeStr {
  return typeof value === 'string' && value in GAME_CONFIGS;
}

/** 对局中隐藏 gameData（防作弊）；结束后透出角色与胜负 */
function publicGamePlayer<T extends { gameData: unknown; role: string }>(
  player: T,
  gameStatus: string,
): Omit<T, 'gameData'> & { gameData: unknown } {
  if (gameStatus === 'finished') return player;
  const { gameData: _hidden, ...rest } = player;
  return { ...rest, gameData: null };
}

/**
 * 获取（或恢复）房间对应的游戏导演。
 * 进程重启后 activeGames 会丢，这里从 DB 的 gameState 重建；
 * 旧版本状态（无 format 字段）无法恢复，直接判负中断。
 */
async function ensureDirector(roomId: string): Promise<GameDirector | null> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, gameType: true, gameStatus: true, gameState: true },
  });
  if (!room || room.gameStatus !== 'playing' || !room.gameType || !isGameType(room.gameType)) return null;

  const existing = GameDirector.get(roomId);
  if (existing) return existing;

  const players = await prisma.gamePlayer.findMany({
    where: { roomId },
    select: { id: true, userId: true, nickname: true, role: true },
    orderBy: { joinedAt: 'asc' },
  });
  if (players.length === 0) return null;

  try {
    const director = GameDirector.restore(roomId, room.gameType, players, room.gameState);
    void director.tick();
    return director;
  } catch {
    // 旧格式状态：标记中断
    const interrupted = (room.gameState as Record<string, unknown> | null) ?? {};
    if (interrupted && typeof interrupted === 'object' && Array.isArray(interrupted.events)) {
      (interrupted.events as unknown[]).push({
        id: crypto.randomUUID(),
        round: 0,
        phase: 'finished',
        type: 'game_end',
        content: '服务器升级导致对局中断，本局已作废。',
        timestamp: Date.now(),
      });
    }
    await prisma.room.update({
      where: { id: roomId },
      data: { gameStatus: 'finished', gameState: interrupted as object },
    });
    return null;
  }
}

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
      gameType: string;
      minPlayers?: number;
      maxPlayers?: number;
      visibility?: 'public' | 'private';
      judgeMode?: 'owner' | 'ai' | null;
    };
    if (!isGameType(body.gameType)) return reply.status(400).send({ error: 'invalid_game_type' });
    if (body.gameType !== 'werewolf' && body.judgeMode) {
      return reply.status(400).send({ error: 'judge_mode_only_for_werewolf' });
    }
    const config = GAME_CONFIGS[body.gameType];
    if (!body.title?.trim()) return reply.status(400).send({ error: 'missing_title' });

    // 人数限制钳制到游戏规则范围内
    const minPlayers = Math.min(Math.max(body.minPlayers ?? config.min, 2), config.max);
    const maxPlayers = Math.min(Math.max(body.maxPlayers ?? config.max, minPlayers), config.max);

    const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { displayName: true } });

    const room = await prisma.room.create({
      data: {
        title: body.title.trim().slice(0, 120),
        description: body.description ?? '',
        type: 'entertainment',
        mode: 'free',
        status: 'idle',
        visibility: body.visibility ?? 'public',
        gameType: body.gameType,
        gameStatus: 'waiting',
        minPlayers,
        maxPlayers,
        ownerId: user.id,
        judgeMode: body.judgeMode ?? null,
      },
    });

    // 房主自动成为第一个玩家（owner 法官模式下，房主将在开局时成为法官不分配角色）
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

  /** 房间详情（对局中隐藏角色数据与完整状态，防作弊） */
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
    // 对局中不下发 gameState（内含全部角色）
    const { gameState: _hidden, ...rest } = room;
    return {
      ...rest,
      gamePlayers: room.gamePlayers.map((p) => publicGamePlayer(p, room.gameStatus)),
    };
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
    roomGateway.broadcast(roomId, { type: 'game_player_joined', payload: { player: { id: player.id, nickname: player.nickname, role: player.role } } });

    return reply.status(201).send(player);
  });

  /** 离开游戏（仅等待阶段） */
  fastify.post('/rooms/:roomId/leave', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const user = authedUser(request);

    const room = await prisma.room.findFirst({ where: { id: roomId, type: 'entertainment' } });
    if (!room) return reply.status(404).send({ error: 'room_not_found' });
    if (room.gameStatus !== 'waiting') return reply.status(400).send({ error: 'game_already_started' });

    const player = await prisma.gamePlayer.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
    });
    if (!player) return reply.status(404).send({ error: 'not_in_room' });
    if (room.ownerId === user.id) {
      return reply.status(400).send({ error: 'owner_cannot_leave', message: '房主不能离开，可以解散房间' });
    }

    await prisma.gamePlayer.delete({ where: { id: player.id } });
    await maybeReady(roomId);
    roomGateway.broadcast(roomId, { type: 'game_player_left', payload: { playerId: player.id } });

    return reply.status(204).send();
  });

  /** 邀请用户 */
  fastify.post('/rooms/:roomId/invite', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    await roomAccess(request, roomId, 'owner');
    const { email } = request.body as { email: string };

    const target = await prisma.user.findUnique({ where: { email }, select: { id: true, displayName: true } });
    if (!target) return reply.status(404).send({ error: 'user_not_found' });

    const room = await prisma.room.findFirst({ where: { id: roomId, type: 'entertainment' } });
    if (!room) return reply.status(404).send({ error: 'room_not_found' });
    if (room.gameStatus !== 'waiting') return reply.status(400).send({ error: 'game_not_waiting' });

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
    roomGateway.broadcast(roomId, { type: 'game_player_joined', payload: { player: { id: player.id, nickname: player.nickname, role: player.role } } });

    return reply.status(201).send(player);
  });

  /** 添加 AI 玩家（房主，等待阶段） */
  fastify.post('/rooms/:roomId/ai', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    await roomAccess(request, roomId, 'owner');
    const body = request.body as { profileId?: string; nickname?: string };

    const room = await prisma.room.findFirst({ where: { id: roomId, type: 'entertainment' } });
    if (!room) return reply.status(404).send({ error: 'room_not_found' });
    if (room.gameStatus !== 'waiting') return reply.status(400).send({ error: 'game_not_waiting' });

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
    roomGateway.broadcast(roomId, { type: 'game_player_joined', payload: { player: { id: player.id, nickname: player.nickname, role: player.role } } });

    return reply.status(201).send(player);
  });

  /** 移除 AI 玩家（房主，等待阶段） */
  fastify.delete('/rooms/:roomId/ai/:playerId', async (request, reply) => {
    const { roomId, playerId } = request.params as { roomId: string; playerId: string };
    await roomAccess(request, roomId, 'owner');

    const room = await prisma.room.findFirst({ where: { id: roomId, type: 'entertainment' } });
    if (!room) return reply.status(404).send({ error: 'room_not_found' });
    if (room.gameStatus !== 'waiting') return reply.status(400).send({ error: 'game_not_waiting' });

    const player = await prisma.gamePlayer.findFirst({ where: { id: playerId, roomId, role: 'ai' } });
    if (!player) return reply.status(404).send({ error: 'player_not_found' });

    await prisma.gamePlayer.delete({ where: { id: player.id } });
    await maybeReady(roomId);
    roomGateway.broadcast(roomId, { type: 'game_player_left', payload: { playerId: player.id } });

    return reply.status(204).send();
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
    if (!room.gameType || !isGameType(room.gameType)) {
      return reply.status(400).send({ error: 'invalid_game_type' });
    }

    const playerCount = room.gamePlayers.length;
    if (room.minPlayers && playerCount < room.minPlayers) {
      return reply.status(400).send({ error: 'not_enough_players', message: `该游戏至少需要 ${room.minPlayers} 名玩家` });
    }

    // 根据 judgeMode 调整玩家列表
    let players = room.gamePlayers.map((p) => ({
      id: p.id,
      userId: p.userId,
      nickname: p.nickname,
      role: p.role,
    }));

    let aiJudgePlayerId: string | null = null;

    if (room.gameType === 'werewolf' && room.judgeMode === 'owner') {
      // 房主当法官：从玩家列表中移除房主（不分配角色），但保留其玩家 ID 作为法官 ID
      const ownerGamePlayer = players.find((p) => p.userId === room.ownerId);
      if (ownerGamePlayer) {
        players = players.filter((p) => p.id !== ownerGamePlayer.id);
        aiJudgePlayerId = ownerGamePlayer.id;
      }
    } else if (room.gameType === 'werewolf' && room.judgeMode === 'ai') {
      // AI 法官：添加一名 AI 法官参与游戏（但不分配身份，仅负责广播）
      const existingAiJudge = room.gamePlayers.find((p) => p.role === 'ai' && p.nickname === 'AI 法官');
      if (existingAiJudge) {
        aiJudgePlayerId = existingAiJudge.id;
      } else {
        const aiJudge = await prisma.gamePlayer.create({
          data: { roomId, nickname: 'AI 法官', role: 'ai' },
        });
        players = [...players, { id: aiJudge.id, userId: null, nickname: aiJudge.nickname, role: aiJudge.role }];
        aiJudgePlayerId = aiJudge.id;
      }
    }

    const playerCountForGame = players.length;
    const config = GAME_CONFIGS[room.gameType];
    // 法官模式下需额外多一个人
    const effectiveMin = room.judgeMode === 'ai' ? Math.max(room.minPlayers ?? config.min, 7) : (room.judgeMode === 'owner' ? Math.max(room.minPlayers ?? config.min, 6) : (room.minPlayers ?? config.min));
    if (playerCountForGame < effectiveMin) {
      return reply.status(400).send({ error: 'not_enough_players', message: `该游戏至少需要 ${effectiveMin} 名玩家（不含法官）` });
    }

    let director: GameDirector;
    try {
      director = GameDirector.create(roomId, room.gameType, players, {
        judgeMode: room.judgeMode,
        judgePlayerId: aiJudgePlayerId,
        ownerUserId: room.ownerId,
      });
    } catch (error) {
      if (error instanceof GameError) {
        GameDirector.dispose(roomId);
        return reply.status(400).send({ error: error.code, message: error.message });
      }
      throw error;
    }

    await director.writeStartData();
    await director.persist();

    await prisma.room.update({
      where: { id: roomId },
      data: { gameStatus: 'playing' },
    });

    const allPlayers = room.gamePlayers.map((p) => ({ id: p.id, nickname: p.nickname, role: p.role }));
    roomGateway.broadcast(roomId, {
      type: 'game_started',
      payload: {
        players: allPlayers,
        judgeMode: room.judgeMode,
        judgePlayerId: aiJudgePlayerId,
      },
    });

    void director.tick();

    return reply.status(200).send({ gameStatus: 'playing', judgeMode: room.judgeMode });
  });

  /** 获取游戏状态（按请求者视角净化） */
  fastify.get('/rooms/:roomId/state', async (request) => {
    const { roomId } = request.params as { roomId: string };
    const user = authedUser(request);

    const room = await prisma.room.findFirst({
      where: { id: roomId, type: 'entertainment' },
      select: { id: true, gameType: true, gameStatus: true, gameState: true },
    });
    if (!room) throw new NotFound('room_not_found');
    if (!room.gameType || !isGameType(room.gameType)) {
      return { gameStatus: room.gameStatus, gameType: room.gameType, myPlayerId: null, deadline: null, view: null };
    }

    const director = room.gameStatus === 'playing' ? await ensureDirector(roomId) : null;

    // 结束后直接用持久化的终局视角（全量公开）
    if (room.gameStatus === 'finished' || !director) {
      return {
        gameStatus: room.gameStatus,
        gameType: room.gameType,
        myPlayerId: null,
        deadline: null,
        view: room.gameStatus === 'finished' ? finishedView(room.gameState) : null,
      };
    }

    const view = director.getView(user.id);
    const myPlayerId = director.getPlayerIdByUser(user.id);
    return {
      gameStatus: room.gameStatus,
      gameType: room.gameType,
      myPlayerId,
      deadline: director.getDeadlineAt(),
      view,
    };
  });

  /** 游戏动作（发言/投票/夜间行动等） */
  fastify.post('/rooms/:roomId/action', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const user = authedUser(request);
    const body = request.body as GameActionBody;
    if (!body?.type) return reply.status(400).send({ error: 'missing_action_type' });

    const room = await prisma.room.findFirst({
      where: { id: roomId, type: 'entertainment' },
      select: { id: true, gameStatus: true },
    });
    if (!room) throw new NotFound('room_not_found');
    if (room.gameStatus !== 'playing') return reply.status(400).send({ error: 'game_not_active' });

    const director = await ensureDirector(roomId);
    if (!director) return reply.status(400).send({ error: 'game_not_active' });

    try {
      await director.handleUserAction(user.id, body);
    } catch (error) {
      if (error instanceof GameError) {
        return reply.status(400).send({ error: error.code, message: error.message });
      }
      throw error;
    }

    return {
      ok: true,
      view: director.getView(user.id),
      deadline: director.getDeadlineAt(),
    };
  });

  /** 获取游戏复盘数据（终局全量公开） */
  fastify.get('/rooms/:roomId/review', async (request) => {
    const { roomId } = request.params as { roomId: string };
    const room = await prisma.room.findFirst({
      where: { id: roomId, type: 'entertainment' },
      include: {
        gamePlayers: {
          include: {
            user: { select: { id: true, displayName: true } },
            profile: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!room) throw new NotFound('room_not_found');

    const gameState = room.gameState as Record<string, unknown> | null;
    const finished = room.gameStatus === 'finished';
    return {
      room: {
        id: room.id,
        title: room.title,
        gameType: room.gameType,
        gameStatus: room.gameStatus,
        createdAt: room.createdAt,
      },
      players: room.gamePlayers.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        role: p.role,
        isAlive: p.isAlive,
        gameRole: finished ? ((p.gameData as { gameRole?: string } | null)?.gameRole ?? null) : null,
        won: finished ? ((p.gameData as { won?: boolean | null } | null)?.won ?? null) : null,
      })),
      events: finished ? (gameState?.events ?? []) : [],
      winner: finished ? gameState?.winner : undefined,
      gameState: finished ? gameState : null,
    };
  });

  /** 获取游戏统计（按 gameData.won 结算，通用于所有游戏） */
  fastify.get('/stats', async (request) => {
    const user = authedUser(request);

    const participations = await prisma.gamePlayer.findMany({
      where: { userId: user.id },
      include: {
        room: {
          select: {
            id: true,
            gameType: true,
            gameStatus: true,
          },
        },
      },
    });

    const finishedGames = participations.filter((p) => p.room.gameStatus === 'finished');

    const stats = {
      totalGames: finishedGames.length,
      wins: 0,
      losses: 0,
      byGameType: {} as Record<string, { total: number; wins: number }>,
    };

    for (const game of finishedGames) {
      const gameType = game.room.gameType ?? 'unknown';
      if (!stats.byGameType[gameType]) {
        stats.byGameType[gameType] = { total: 0, wins: 0 };
      }
      stats.byGameType[gameType].total += 1;

      const won = (game.gameData as { won?: boolean | null } | null)?.won;
      if (won === true) {
        stats.wins += 1;
        stats.byGameType[gameType].wins += 1;
      } else if (won === false) {
        stats.losses += 1;
      }
    }

    return stats;
  });

  /** 重新开局（房主）：清除本局数据，重置房间到 waiting 状态，可继续用原阵容或调整后再开 */
  fastify.post('/rooms/:roomId/restart', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    await roomAccess(request, roomId, 'owner');

    const room = await prisma.room.findFirst({
      where: { id: roomId, type: 'entertainment' },
      include: { gamePlayers: true },
    });
    if (!room) return reply.status(404).send({ error: 'room_not_found' });
    if (room.gameStatus === 'playing') return reply.status(400).send({ error: 'game_in_progress' });

    // 结束正在进行的导演循环
    GameDirector.dispose(roomId);

    // 清空该房间所有玩家（保留房主重新加入）
    await prisma.gamePlayer.deleteMany({ where: { roomId } });

    // 重新写入房主为第一个玩家
    const dbUser = await prisma.user.findUnique({ where: { id: room.ownerId }, select: { displayName: true } });
    await prisma.gamePlayer.create({
      data: { roomId, userId: room.ownerId, nickname: dbUser?.displayName ?? '房主', role: 'human' },
    });

    // 重置房间状态
    await prisma.room.update({
      where: { id: roomId },
      data: { gameStatus: 'waiting', gameState: Prisma.JsonNull },
    });

    roomGateway.broadcast(roomId, { type: 'game_restarted', payload: { roomId } });
    return reply.status(200).send({ gameStatus: 'waiting' });
  });

  /** 踢出玩家（房主，等待或已结束状态） */
  fastify.delete('/rooms/:roomId/players/:playerId', async (request, reply) => {
    const { roomId, playerId } = request.params as { roomId: string; playerId: string };
    await roomAccess(request, roomId, 'owner');

    const room = await prisma.room.findFirst({ where: { id: roomId, type: 'entertainment' } });
    if (!room) return reply.status(404).send({ error: 'room_not_found' });
    if (room.gameStatus === 'playing') return reply.status(400).send({ error: 'game_in_progress' });

    const player = await prisma.gamePlayer.findFirst({ where: { id: playerId, roomId } });
    if (!player) return reply.status(404).send({ error: 'player_not_found' });
    if (room.ownerId === player.userId) return reply.status(400).send({ error: 'cannot_kick_owner' });

    await prisma.gamePlayer.delete({ where: { id: player.id } });
    await maybeReady(roomId);
    roomGateway.broadcast(roomId, { type: 'game_player_left', payload: { playerId: player.id, nickname: player.nickname } });

    return reply.status(204).send();
  });

  /** 解散房间（房主，仅等待或已结束状态） */
  fastify.delete('/rooms/:roomId', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    await roomAccess(request, roomId, 'owner');

    const room = await prisma.room.findFirst({ where: { id: roomId, type: 'entertainment' } });
    if (!room) return reply.status(404).send({ error: 'room_not_found' });
    if (room.gameStatus === 'playing') return reply.status(400).send({ error: 'game_in_progress' });

    GameDirector.dispose(roomId);
    await prisma.room.delete({ where: { id: roomId } });

    return reply.status(204).send();
  });
};

/** 检查人数是否已满，更新 ready 状态；人数跌回则恢复 waiting */
async function maybeReady(roomId: string): Promise<void> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { gameStatus: true, maxPlayers: true, _count: { select: { gamePlayers: true } } },
  });
  if (!room || room.gameStatus === 'playing' || room.gameStatus === 'finished') return;
  if (room.maxPlayers && room._count.gamePlayers >= room.maxPlayers) {
    if (room.gameStatus !== 'ready') {
      await prisma.room.update({ where: { id: roomId }, data: { gameStatus: 'ready' } });
    }
  } else if (room.gameStatus === 'ready') {
    await prisma.room.update({ where: { id: roomId }, data: { gameStatus: 'waiting' } });
  }
}

/** 终局视角：把持久化状态里的角色信息公开（复盘用） */
function finishedView(gameState: unknown): Record<string, unknown> | null {
  if (!gameState || typeof gameState !== 'object') return null;
  return gameState as Record<string, unknown>;
}
