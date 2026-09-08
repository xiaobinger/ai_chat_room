import type {
  ThiefGameState,
  ThiefPlayerState,
  ThiefRole,
  InvestigationAction,
} from './who-is-the-thief-types';
import {
  STOLEN_ITEMS,
  CRIME_SCENES,
  CLUES,
  SPECIAL_EVENTS,
} from './who-is-the-thief-types';

/** 根据玩家数量分配角色 */
export function assignThiefRoles(playerIds: string[]): Record<string, ThiefRole> {
  const count = playerIds.length;
  const roles: ThiefRole[] = [];

  // 必有一个小偷和一个侦探
  roles.push('thief', 'detective');

  // 4-5 人：加一个目击者
  // 6-7 人：加一个目击者和一个同伙
  // 8+ 人：加一个目击者、一个同伙和一个神偷（替换普通小偷）
  if (count >= 8 && Math.random() < 0.3) {
    // 30% 概率出现神偷（替换小偷）
    roles[0] = 'master_thief';
  }

  if (count >= 5) {
    roles.push('witness');
  }
  if (count >= 6 && Math.random() < 0.5) {
    roles.push('accomplice');
  }

  // 剩余填充普通市民
  while (roles.length < count) roles.push('citizen');

  // 洗牌
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  const assignments: Record<string, ThiefRole> = {};
  playerIds.forEach((id, index) => {
    assignments[id] = roles[index];
  });

  return assignments;
}

/** 初始化游戏状态 */
export function initThiefGameState(
  players: { playerId: string; nickname: string }[],
): ThiefGameState {
  const assignments = assignThiefRoles(players.map((p) => p.playerId));

  const playerStates: ThiefPlayerState[] = players.map((p) => ({
    playerId: p.playerId,
    nickname: p.nickname,
    role: assignments[p.playerId],
    isAlive: true,
    hasSpoken: false,
    hasInvestigated: false,
    votes: 0,
    isProtected: false,
    hasFramed: false,
    hasRevealedClue: false,
  }));

  const thiefId = playerStates.find((p) => p.role === 'thief' || p.role === 'master_thief')!.playerId;
  const detectiveId = playerStates.find((p) => p.role === 'detective')!.playerId;

  // 随机选择失窃物品和案发现场
  const stolenItem = STOLEN_ITEMS[Math.floor(Math.random() * STOLEN_ITEMS.length)];
  const crimeScene = CRIME_SCENES[Math.floor(Math.random() * CRIME_SCENES.length)];

  // 随机生成 2-3 条线索
  const clueCount = 2 + Math.floor(Math.random() * 2);
  const shuffledClues = [...CLUES].sort(() => Math.random() - 0.5);
  const clues = shuffledClues.slice(0, clueCount);

  return {
    phase: 'investigation',
    round: 1,
    players: playerStates,
    thiefId,
    detectiveId,
    actions: [],
    votes: {},
    stolenItem,
    crimeScene,
    clues,
    events: [
      {
        id: crypto.randomUUID(),
        round: 1,
        phase: 'investigation',
        type: 'game_start',
        content: `游戏开始！${crimeScene}失窃物品：${stolenItem}。共有 ${players.length} 名玩家参与。`,
        timestamp: Date.now(),
      },
    ],
    masterThiefEscapeUsed: false,
  };
}

/** 获取存活玩家 */
export function getAlivePlayers(state: ThiefGameState): ThiefPlayerState[] {
  return state.players.filter((p) => p.isAlive);
}

/** 获取小偷阵营玩家（小偷+同伙+神偷） */
export function getThiefTeam(state: ThiefGameState): ThiefPlayerState[] {
  return state.players.filter(
    (p) => p.isAlive && (p.role === 'thief' || p.role === 'master_thief' || p.role === 'accomplice'),
  );
}

/** 获取市民阵营玩家 */
export function getCitizenTeam(state: ThiefGameState): ThiefPlayerState[] {
  return state.players.filter(
    (p) => p.isAlive && p.role !== 'thief' && p.role !== 'master_thief' && p.role !== 'accomplice',
  );
}

/** 检查胜利条件 */
export function checkThiefVictory(state: ThiefGameState): 'thief' | 'citizen' | null {
  const thiefTeam = getThiefTeam(state);
  const citizenTeam = getCitizenTeam(state);

  // 小偷阵营全部出局 → 市民胜利
  if (thiefTeam.length === 0) return 'citizen';

  // 小偷阵营人数 >= 市民阵营 → 小偷胜利
  if (thiefTeam.length >= citizenTeam.length) return 'thief';

  return null;
}

/** 处理调查阶段动作 */
export function processInvestigationAction(
  state: ThiefGameState,
  action: InvestigationAction,
): ThiefGameState {
  const next = structuredClone(state);
  const actor = next.players.find((p) => p.playerId === action.actorId);
  if (!actor) return next;

  switch (action.type) {
    case 'question':
    case 'answer':
      next.actions.push(action);
      actor.hasSpoken = true;
      break;

    case 'investigate':
      if (actor.role === 'detective' && action.targetId) {
        const target = next.players.find((p) => p.playerId === action.targetId);
        if (target) {
          const isThief = target.role === 'thief' || target.role === 'master_thief';
          action.result = isThief ? `${target.nickname} 是小偷！` : `${target.nickname} 不是小偷。`;
          next.actions.push(action);
          actor.hasInvestigated = true;
        }
      }
      break;

    case 'frame':
      if ((actor.role === 'thief' || actor.role === 'master_thief') && !actor.hasFramed && action.targetId) {
        const target = next.players.find((p) => p.playerId === action.targetId);
        if (target) {
          // 嫁祸：让目标获得额外嫌疑
          target.votes += 2;
          actor.hasFramed = true;
          action.result = `${actor.nickname} 嫁祸给了 ${target.nickname}，使其获得 2 票嫌疑！`;
          next.actions.push(action);
        }
      }
      break;

    case 'reveal_clue':
      if (actor.role === 'witness' && !actor.hasRevealedClue) {
        const clue = next.clues[Math.floor(Math.random() * next.clues.length)];
        action.result = `目击者揭示线索：${clue}`;
        next.actions.push(action);
        actor.hasRevealedClue = true;
      }
      break;
  }

  return next;
}

/** 进入投票阶段 */
export function transitionToVoting(state: ThiefGameState): ThiefGameState {
  const next = structuredClone(state);
  next.phase = 'voting';
  next.players.forEach((p) => {
    p.hasSpoken = false;
    p.hasInvestigated = false;
  });
  return next;
}

/** 结算投票 */
export function resolveThiefVote(state: ThiefGameState): ThiefGameState {
  const next = structuredClone(state);

  // 统计票数
  const voteCounts: Record<string, number> = {};
  for (const [, targetId] of Object.entries(next.votes)) {
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

  // 平票时无人出局
  if (!tie && eliminated) {
    const target = next.players.find((p) => p.playerId === eliminated);
    if (target && target.isAlive && !target.isProtected) {
      // 神偷金蝉脱壳
      if (target.role === 'master_thief' && !next.masterThiefEscapeUsed) {
        next.masterThiefEscapeUsed = true;
        next.events.push({
          id: crypto.randomUUID(),
          round: next.round,
          phase: 'voting',
          type: 'special_event',
          actorName: target.nickname,
          content: `🎉 金蝉脱壳！${target.nickname} 是神偷，成功逃脱了投票！`,
          timestamp: Date.now(),
          role: target.role,
        });
      } else {
        target.isAlive = false;
        next.accusedPlayerId = eliminated;
        next.events.push({
          id: crypto.randomUUID(),
          round: next.round,
          phase: 'voting',
          type: 'vote_result',
          actorName: target.nickname,
          targetName: target.nickname,
          content: `${target.nickname} 被投票出局！身份是：${getRoleLabel(target.role)}`,
          timestamp: Date.now(),
          role: target.role,
        });
      }
    }
  } else if (tie) {
    next.events.push({
      id: crypto.randomUUID(),
      round: next.round,
      phase: 'voting',
      type: 'vote_result',
      content: '投票平票，无人出局！',
      timestamp: Date.now(),
    });
  }

  next.votes = {};
  return next;
}

/** 检查游戏是否结束 */
export function checkThiefGameEnd(state: ThiefGameState): ThiefGameState {
  const next = structuredClone(state);
  const winner = checkThiefVictory(next);
  if (winner) {
    next.phase = 'result';
    next.winner = winner;
    const thiefPlayer = next.players.find((p) => p.playerId === next.thiefId);
    next.events.push({
      id: crypto.randomUUID(),
      round: next.round,
      phase: 'result',
      type: 'game_end',
      content: winner === 'thief' ? `小偷阵营获胜！小偷是 ${thiefPlayer?.nickname}` : `市民阵营获胜！小偷 ${thiefPlayer?.nickname} 被找出来了`,
      timestamp: Date.now(),
    });
  }
  return next;
}

/** 进入下一轮调查 */
export function nextInvestigationRound(state: ThiefGameState): ThiefGameState {
  const next = structuredClone(state);
  next.phase = 'investigation';
  next.round += 1;
  next.actions = [];
  next.votes = {};
  next.players.forEach((p) => {
    p.hasSpoken = false;
    p.hasInvestigated = false;
  });

  // 随机触发彩蛋事件
  if (Math.random() < 0.3) {
    triggerSpecialEvent(next);
  }

  return next;
}

/** 触发彩蛋事件 */
function triggerSpecialEvent(state: ThiefGameState): void {
  const eventKeys = Object.keys(SPECIAL_EVENTS) as (keyof typeof SPECIAL_EVENTS)[];
  const randomEvent = eventKeys[Math.floor(Math.random() * eventKeys.length)];
  const event = SPECIAL_EVENTS[randomEvent];

  state.events.push({
    id: crypto.randomUUID(),
    round: state.round,
    phase: state.phase,
    type: 'special_event',
    content: `🎭 ${event.label}：${event.description}`,
    timestamp: Date.now(),
  });
}

/** 获取角色标签 */
function getRoleLabel(role: ThiefRole): string {
  const labels: Record<ThiefRole, string> = {
    thief: '小偷',
    detective: '侦探',
    citizen: '普通市民',
    master_thief: '神偷',
    accomplice: '同伙',
    witness: '目击者',
  };
  return labels[role] ?? role;
}

/** 生成 AI 调查发言 */
export function generateInvestigationSpeech(
  state: ThiefGameState,
  player: ThiefPlayerState,
): InvestigationAction {
  const { role } = player;
  const alivePlayers = getAlivePlayers(state).filter((p) => p.playerId !== player.playerId);

  if (role === 'thief' || role === 'master_thief') {
    // 小偷：混淆视听，嫁祸他人
    const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    const templates = [
      `我觉得 ${target.nickname} 的表现很可疑，一直在转移话题。`,
      `我注意到 ${target.nickname} 对案件细节了解得太多了。`,
      `${target.nickname} 刚才的回答有些前后矛盾。`,
      `我怀疑 ${target.nickname}，他的眼神在闪躲。`,
    ];
    return {
      type: 'question',
      actorId: player.playerId,
      targetId: target.playerId,
      content: templates[Math.floor(Math.random() * templates.length)],
    };
  }

  if (role === 'accomplice') {
    // 同伙：帮助小偷转移注意力
    const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    const templates = [
      `我觉得大家不应该只关注一个人，${target.nickname} 也有嫌疑。`,
      `我认为我们应该多听听 ${target.nickname} 的说法。`,
      `${target.nickname} 刚才的发言有些奇怪。`,
    ];
    return {
      type: 'question',
      actorId: player.playerId,
      targetId: target.playerId,
      content: templates[Math.floor(Math.random() * templates.length)],
    };
  }

  if (role === 'detective') {
    // 侦探：分析线索，引导推理
    const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    const templates = [
      `根据我的调查，${target.nickname} 需要解释一下刚才的发言。`,
      `我掌握了一些线索，${target.nickname} 请回答我的问题。`,
      `从目前的证据来看，${target.nickname} 的嫌疑不能排除。`,
    ];
    return {
      type: 'question',
      actorId: player.playerId,
      targetId: target.playerId,
      content: templates[Math.floor(Math.random() * templates.length)],
    };
  }

  if (role === 'witness') {
    // 目击者：提供线索
    const templates = [
      `我注意到了一些不寻常的细节...`,
      `根据我的观察，事情可能不是表面看起来那样。`,
      `我有一个线索想和大家分享。`,
    ];
    return {
      type: 'question',
      actorId: player.playerId,
      content: templates[Math.floor(Math.random() * templates.length)],
    };
  }

  // 普通市民
  const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
  const templates = [
    `我觉得 ${target.nickname} 的发言有些可疑。`,
    `我同意侦探的看法，${target.nickname} 需要解释一下。`,
    `从目前的线索来看，${target.nickname} 不能排除嫌疑。`,
    `我注意到 ${target.nickname} 一直在回避关键问题。`,
  ];
  return {
    type: 'question',
    actorId: player.playerId,
    targetId: target.playerId,
    content: templates[Math.floor(Math.random() * templates.length)],
  };
}

/** 生成 AI 投票 */
export function decideThiefVote(
  state: ThiefGameState,
  player: ThiefPlayerState,
): { playerId: string; targetId: string } {
  const { role } = player;
  const alivePlayers = getAlivePlayers(state).filter((p) => p.playerId !== player.playerId);

  if (alivePlayers.length === 0) {
    return { playerId: player.playerId, targetId: player.playerId };
  }

  let target: ThiefPlayerState;

  if (role === 'thief' || role === 'master_thief' || role === 'accomplice') {
    // 小偷阵营：投给非小偷阵营的玩家
    const citizens = alivePlayers.filter((p) => p.role === 'citizen' || p.role === 'detective' || p.role === 'witness');
    target = citizens[Math.floor(Math.random() * citizens.length)] ?? alivePlayers[0];
  } else if (role === 'detective') {
    // 侦探：如果调查过小偷，投给小偷；否则随机投
    const investigatedThief = alivePlayers.find(
      (p) => (p.role === 'thief' || p.role === 'master_thief') && p.votes > 0,
    );
    target = investigatedThief ?? alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
  } else {
    // 市民/目击者：投给嫌疑最高的人或随机
    const suspicious = alivePlayers.sort((a, b) => b.votes - a.votes)[0];
    target = suspicious ?? alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
  }

  return { playerId: player.playerId, targetId: target.playerId };
}
