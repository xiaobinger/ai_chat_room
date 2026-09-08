import type { GameState, GameAction, PlayerState, WerewolfRole, DayMessage } from './types';

/** 根据玩家数量分配角色 */
export function assignRoles(playerIds: string[]): Record<string, WerewolfRole> {
  const count = playerIds.length;
  const roles: WerewolfRole[] = [];

  // 狼人数量
  const wolfCount = count <= 8 ? 2 : count <= 11 ? 3 : 4;

  // 必有一个预言家、女巫、猎人
  roles.push('seer', 'witch', 'hunter');

  // 填充狼人
  for (let i = 0; i < wolfCount; i++) roles.push('werewolf');

  // 剩余填充村民
  while (roles.length < count) roles.push('villager');

  // 洗牌
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  // 分配给玩家
  const assignments: Record<string, WerewolfRole> = {};
  playerIds.forEach((id, index) => {
    assignments[id] = roles[index];
  });

  return assignments;
}

/** 初始化游戏状态 */
export function initGameState(
  players: { playerId: string; nickname: string }[],
): GameState {
  const assignments = assignRoles(players.map((p) => p.playerId));

  const playerStates: PlayerState[] = players.map((p) => ({
    playerId: p.playerId,
    nickname: p.nickname,
    role: assignments[p.playerId],
    isAlive: true,
  }));

  return {
    phase: 'night',
    round: 1,
    players: playerStates,
    dayMessages: [],
    votes: {},
    deadTonight: [],
    deadToday: [],
  };
}

/** 获取存活玩家 */
export function getAlivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.isAlive);
}

/** 获取存活狼人 */
export function getAliveWerewolves(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.isAlive && p.role === 'werewolf');
}

/** 获取存活村民（非狼人） */
export function getAliveVillagers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.isAlive && p.role !== 'werewolf');
}

/** 检查胜利条件 */
export function checkVictory(state: GameState): 'werewolf' | 'villager' | null {
  const wolves = getAliveWerewolves(state).length;
  const villagers = getAliveVillagers(state).length;

  if (wolves === 0) return 'villager';
  if (wolves >= villagers) return 'werewolf';
  return null;
}

/** 处理游戏动作 */
export function processAction(state: GameState, action: GameAction): GameState {
  const next = structuredClone(state);

  switch (action.type) {
    case 'werewolf_kill':
      next.werewolfTarget = action.targetId;
      break;

    case 'seer_check':
      if (action.targetId) {
        const target = next.players.find((p) => p.playerId === action.targetId);
        next.seerTarget = action.targetId;
        next.seerResult = {
          target: action.targetId,
          isWerewolf: target?.role === 'werewolf',
        };
      }
      break;

    case 'witch_save':
      if (action.targetId) {
        const target = next.players.find((p) => p.playerId === action.targetId);
        if (target) target.isProtected = true;
        next.witchAction = { ...next.witchAction, type: 'save' };
      }
      break;

    case 'witch_poison':
      if (action.targetId) {
        const target = next.players.find((p) => p.playerId === action.targetId);
        if (target) {
          target.isAlive = false;
          next.deadTonight.push(action.targetId);
        }
        next.witchAction = { ...next.witchAction, type: 'poison', target: action.targetId };
      }
      break;

    case 'day_speak':
      if (action.content) {
        const player = next.players.find((p) => p.playerId === action.playerId);
        if (player) {
          next.dayMessages.push({
            playerId: action.playerId,
            nickname: player.nickname,
            content: action.content,
            timestamp: Date.now(),
          });
        }
      }
      break;

    case 'vote':
      if (action.targetId) {
        next.votes[action.playerId] = action.targetId;
      }
      break;

    case 'hunter_shoot':
      if (action.targetId) {
        const target = next.players.find((p) => p.playerId === action.targetId);
        if (target) {
          target.isAlive = false;
          next.deadToday.push(action.targetId);
        }
      }
      next.hunterCanShoot = false;
      break;
  }

  return next;
}

/** 进入白天阶段：结算夜晚死亡 */
export function transitionToDay(state: GameState): GameState {
  const next = structuredClone(state);

  // 狼人杀人结算
  if (next.werewolfTarget && !next.players.find((p) => p.playerId === next.werewolfTarget)?.isProtected) {
    const target = next.players.find((p) => p.playerId === next.werewolfTarget);
    if (target && target.isAlive) {
      target.isAlive = false;
      next.deadTonight.push(next.werewolfTarget);
      if (target.role === 'hunter') next.hunterCanShoot = true;
    }
  }

  next.phase = 'day';
  next.dayMessages = [];
  next.werewolfTarget = undefined;
  next.seerTarget = undefined;
  next.seerResult = undefined;

  // 清除保护状态
  next.players.forEach((p) => (p.isProtected = undefined));

  return next;
}

/** 结算投票 */
export function resolveVote(state: GameState): GameState {
  const next = structuredClone(state);

  // 统计票数
  const voteCounts: Record<string, number> = {};
  for (const targetId of Object.values(next.votes)) {
    voteCounts[targetId] = (voteCounts[targetId] ?? 0) + 1;
  }

  // 找出票数最多的玩家
  let maxVotes = 0;
  let eliminated: string | null = null;
  let tie = false;

  for (const [playerId, count] of Object.entries(voteCounts)) {
    if (count > maxVotes) {
      maxVotes = count;
      eliminated = playerId;
      tie = false;
    } else if (count === maxVotes) {
      tie = true;
    }
  }

  // 平票无人出局
  if (!tie && eliminated) {
    const target = next.players.find((p) => p.playerId === eliminated);
    if (target && target.isAlive) {
      target.isAlive = false;
      next.deadToday.push(eliminated);
      if (target.role === 'hunter') next.hunterCanShoot = true;
    }
  }

  next.votes = {};
  return next;
}

/** 进入夜晚阶段 */
export function transitionToNight(state: GameState): GameState {
  const next = structuredClone(state);
  next.phase = 'night';
  next.round += 1;
  next.dayMessages = [];
  next.votes = {};
  next.deadTonight = [];
  next.deadToday = [];
  next.witchAction = undefined;
  return next;
}

/** 检查游戏是否结束，返回获胜方 */
export function checkGameEnd(state: GameState): GameState {
  const next = structuredClone(state);
  const winner = checkVictory(next);
  if (winner) {
    next.phase = 'finished';
    next.winner = winner;
  }
  return next;
}

/** 获取玩家可见信息（隐藏其他玩家角色） */
export function getPlayerView(state: GameState, playerId: string): {
  phase: string;
  round: number;
  players: { playerId: string; nickname: string; isAlive: boolean; role?: WerewolfRole }[];
  myRole?: WerewolfRole;
  dayMessages: DayMessage[];
  votes: Record<string, string>;
  deadTonight: string[];
  deadToday: string[];
  winner?: string;
  seerResult?: { target: string; isWerewolf: boolean };
} {
  const me = state.players.find((p) => p.playerId === playerId);

  return {
    phase: state.phase,
    round: state.round,
    players: state.players.map((p) => ({
      playerId: p.playerId,
      nickname: p.nickname,
      isAlive: p.isAlive,
      role: p.playerId === playerId ? p.role : undefined,
    })),
    myRole: me?.role,
    dayMessages: state.dayMessages,
    votes: state.votes,
    deadTonight: state.deadTonight,
    deadToday: state.deadToday,
    winner: state.winner,
    seerResult: me?.role === 'seer' ? state.seerResult : undefined,
  };
}
