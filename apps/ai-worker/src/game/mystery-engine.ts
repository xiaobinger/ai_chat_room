import type {
  MysteryGameState,
  MysteryPlayerState,
  CharacterCard,
  ClueCard,
  DiscussionEntry,
} from './mystery-types';
import { MYSTERY_SCENARIOS, CHARACTER_POOL, CLUE_POOL } from './mystery-types';

/** 分配角色 */
export function assignMysteryRoles(playerIds: string[]): { characters: Record<string, CharacterCard>; murdererId: string } {
  const shuffledChars = [...CHARACTER_POOL].sort(() => Math.random() - 0.5);
  const characters: Record<string, CharacterCard> = {};
  let murdererId = '';

  // 随机选择一名玩家作为凶手
  const murdererIndex = Math.floor(Math.random() * playerIds.length);

  playerIds.forEach((playerId, index) => {
    const charTemplate = shuffledChars[index % shuffledChars.length];
    const isMurderer = index === murdererIndex;
    const character: CharacterCard = {
      ...charTemplate,
      id: `char-${playerId}`,
      isMurderer,
      // 凶手的秘密不同
      secret: isMurderer ? '你就是凶手！洗清嫌疑，嫁祸他人。' : charTemplate.secret,
      objective: isMurderer ? '隐藏身份，嫁祸他人，逃脱指控。' : charTemplate.objective,
    };
    characters[playerId] = character;
    if (isMurderer) murdererId = playerId;
  });

  return { characters, murdererId };
}

/** 初始化游戏状态 */
export function initMysteryState(
  players: { playerId: string; nickname: string }[],
): MysteryGameState {
  const { characters, murdererId } = assignMysteryRoles(players.map((p) => p.playerId));

  const scenario = MYSTERY_SCENARIOS[Math.floor(Math.random() * MYSTERY_SCENARIOS.length)];

  const playerStates: MysteryPlayerState[] = players.map((p) => ({
    playerId: p.playerId,
    nickname: p.nickname,
    character: characters[p.playerId],
    isAlive: true,
    hasSpoken: false,
    hasSearched: false,
    votes: 0,
    suspicionLevel: 0,
  }));

  // 随机选择 4-6 条线索
  const clueCount = Math.min(4 + Math.floor(Math.random() * 3), CLUE_POOL.length);
  const shuffledClues = [...CLUE_POOL].sort(() => Math.random() - 0.5).slice(0, clueCount);
  const clues: ClueCard[] = shuffledClues.map((c) => ({
    ...c,
    id: `clue-${crypto.randomUUID()}`,
  }));

  return {
    format: 2,
    phase: 'introduction',
    round: 1,
    players: playerStates,
    victim: scenario.victim,
    crimeScene: scenario.crimeScene,
    murderWeapon: scenario.murderWeapon,
    murdererId,
    clues,
    discoveredClues: [],
    discussionLog: [],
    votes: {},
    voteStatus: {},
    events: [
      {
        id: crypto.randomUUID(),
        round: 1,
        phase: 'introduction',
        type: 'game_start',
        content: `剧本杀《${scenario.title}》开始！${scenario.crimeScene}凶手就在你们之中...`,
        timestamp: Date.now(),
      },
    ],
  };
}

/** 获取存活玩家 */
export function getAlivePlayers(state: MysteryGameState): MysteryPlayerState[] {
  return state.players.filter((p) => p.isAlive);
}

/** 发现线索 */
export function discoverClue(state: MysteryGameState, playerId: string, clueId: string): MysteryGameState {
  const next = structuredClone(state);
  const clue = next.clues.find((c) => c.id === clueId);
  const player = next.players.find((p) => p.playerId === playerId);

  if (!clue || !player || next.discoveredClues.includes(clueId)) return state;

  next.discoveredClues.push(clueId);
  clue.discoveredBy = playerId;

  next.events.push({
    id: crypto.randomUUID(),
    round: next.round,
    phase: next.phase,
    type: 'clue_discovered',
    actorName: player.nickname,
    characterName: player.character.name,
    content: `${player.nickname}（${player.character.name}）发现了线索【${clue.name}】：${clue.revealsInfo}`,
    timestamp: Date.now(),
  });

  return next;
}

/** 添加讨论发言 */
export function addDiscussion(
  state: MysteryGameState,
  playerId: string,
  content: string,
  type: DiscussionEntry['type'],
): MysteryGameState {
  const next = structuredClone(state);
  const player = next.players.find((p) => p.playerId === playerId);
  if (!player) return state;
  if (player.hasSpoken) return state;
  const text = content.trim().slice(0, 200);
  if (!text) return state;

  const entry: DiscussionEntry = {
    playerId,
    playerName: player.nickname,
    characterName: player.character.name,
    content: text,
    timestamp: Date.now(),
    type,
  };

  next.discussionLog.push(entry);
  player.hasSpoken = true;

  next.events.push({
    id: crypto.randomUUID(),
    round: next.round,
    phase: next.phase,
    type: 'roleplay',
    actorName: player.nickname,
    characterName: player.character.name,
    content: `${player.nickname}（${player.character.name}）：${text}`,
    timestamp: Date.now(),
  });

  return next;
}

/** 跳过发言 */
export function skipDiscussion(state: MysteryGameState, playerId: string): MysteryGameState {
  const next = structuredClone(state);
  const player = next.players.find((p) => p.playerId === playerId);
  if (!player || player.hasSpoken) return state;
  player.hasSpoken = true;
  next.events.push({
    id: crypto.randomUUID(),
    round: next.round,
    phase: next.phase,
    type: 'roleplay',
    actorName: player.nickname,
    characterName: player.character.name,
    content: `${player.nickname}（${player.character.name}）沉默不语。`,
    timestamp: Date.now(),
  });
  return next;
}

/** 随机发现一条未公开线索（人类/AI 搜证共用） */
export function searchRandomClue(state: MysteryGameState, playerId: string): MysteryGameState {
  const next = structuredClone(state);
  const undiscovered = next.clues.filter((c) => !next.discoveredClues.includes(c.id));
  if (undiscovered.length === 0) return state;
  const clue = undiscovered[Math.floor(Math.random() * undiscovered.length)];
  return discoverClue(next, playerId, clue.id);
}

/** 投票（targetId 为 null 表示弃票） */
export function applyMysteryVote(state: MysteryGameState, playerId: string, targetId: string | null): MysteryGameState {
  const next = structuredClone(state);
  const voter = next.players.find((p) => p.playerId === playerId);
  if (!voter) return state;
  if (next.phase !== 'voting') return state;
  if (!voter.isAlive) return state;
  if (next.voteStatus[playerId]) return state;

  if (targetId === null) {
    next.voteStatus[playerId] = 'abstained';
    return next;
  }
  const target = next.players.find((p) => p.playerId === targetId);
  if (!target || !target.isAlive || targetId === playerId) return state;

  next.voteStatus[playerId] = 'voted';
  next.votes[playerId] = targetId;
  return next;
}

/** 结算投票 */
export function resolveMysteryVote(state: MysteryGameState): MysteryGameState {
  const next = structuredClone(state);

  // 统计票数
  const voteCounts: Record<string, number> = {};
  for (const targetId of Object.values(next.votes)) {
    voteCounts[targetId] = (voteCounts[targetId] ?? 0) + 1;
  }

  // 找出票数最多的玩家
  let maxVotes = 0;
  let accused: string | null = null;
  let tie = false;

  for (const [playerId, count] of Object.entries(voteCounts)) {
    if (count > maxVotes) {
      maxVotes = count;
      accused = playerId;
      tie = false;
    } else if (count === maxVotes) {
      tie = true;
    }
  }

  // 平票时无人被指控
  if (!tie && accused) {
    next.accusedMurdererId = accused;
    const accusedPlayer = next.players.find((p) => p.playerId === accused);
    const isCorrect = accused === next.murdererId;

    next.events.push({
      id: crypto.randomUUID(),
      round: next.round,
      phase: 'voting',
      type: 'vote_result',
      actorName: accusedPlayer?.nickname,
      characterName: accusedPlayer?.character.name,
      content: isCorrect
        ? `${accusedPlayer?.nickname} 被指控为凶手！指控正确！`
        : `${accusedPlayer?.nickname} 被指控为凶手！指控错误！真正的凶手是...`,
      timestamp: Date.now(),
    });

    next.winner = isCorrect ? 'detectives' : 'murderer';
  } else {
    next.events.push({
      id: crypto.randomUUID(),
      round: next.round,
      phase: 'voting',
      type: 'vote_result',
      content: '投票平票！凶手逃脱了...',
      timestamp: Date.now(),
    });
    next.winner = 'murderer';
  }

  next.phase = 'reveal';
  return next;
}

/** 生成 AI 角色扮演发言 */
export function generateMysterySpeech(
  state: MysteryGameState,
  player: MysteryPlayerState,
  type: 'introduction' | 'investigation' | 'discussion' | 'accusation',
): string {
  const { character } = player;
  const isMurderer = character.isMurderer;

  if (type === 'introduction') {
    // 自我介绍
    const templates = [
      `大家好，我是${character.name}，${character.role}。${character.backstory}`,
      `我是${character.name}，在这家已经工作很久了。${character.relationshipToVictim}`,
      `你们好，我是${character.name}。关于这件事，我知道一些内情...`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  if (type === 'investigation') {
    // 调查阶段的发言
    if (isMurderer) {
      const templates = [
        `我觉得我们应该冷静分析，不要被表面现象迷惑。`,
        `我注意到有些人的不在场证明似乎不太完整...`,
        `这件事很复杂，我们需要更多线索才能下结论。`,
      ];
      return templates[Math.floor(Math.random() * templates.length)];
    } else {
      const templates = [
        `根据我的观察，有些人的行为很可疑。`,
        `${character.secret} 我觉得这可能与案件有关。`,
        `我们应该仔细调查每个人的不在场证明。`,
      ];
      return templates[Math.floor(Math.random() * templates.length)];
    }
  }

  if (type === 'accusation') {
    // 指控阶段
    if (isMurderer) {
      // 凶手：嫁祸他人
      const others = getAlivePlayers(state).filter((p) => p.playerId !== player.playerId);
      const target = others[Math.floor(Math.random() * others.length)];
      return `我觉得${target.nickname}很可疑，${target.character.alibi} 这个不在站不住脚！`;
    } else {
      // 侦探：根据线索推理
      const suspicious = getAlivePlayers(state).filter((p) => p.suspicionLevel > 0);
      if (suspicious.length > 0) {
        const target = suspicious[Math.floor(Math.random() * suspicious.length)];
        return `根据线索，我认为${target.nickname}有重大嫌疑！`;
      }
      return `我还在收集证据，但我感觉真相即将浮出水面...`;
    }
  }

  // 讨论阶段
  if (isMurderer) {
    const templates = [
      `我觉得我们要团结一致，不要被凶手带节奏。`,
      `我注意到有人在转移话题，大家小心。`,
      `根据我的经验，这种案子通常有出人意料的真相。`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  } else {
    const templates = [
      `从现有的线索来看，凶手一定留下了蛛丝马迹。`,
      `我有个想法，但需要更多证据来验证。`,
      `我们不应该轻易下结论，要继续调查。`,
      `${character.personality} 的直觉告诉我，真相只有一个。`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }
}

/** 生成 AI 投票 */
export function decideMysteryVote(
  state: MysteryGameState,
  player: MysteryPlayerState,
): { playerId: string; targetId: string } {
  const { character } = player;
  const isMurderer = character.isMurderer;
  const alivePlayers = getAlivePlayers(state).filter((p) => p.playerId !== player.playerId);

  if (alivePlayers.length === 0) {
    return { playerId: player.playerId, targetId: player.playerId };
  }

  let target: MysteryPlayerState;

  if (isMurderer) {
    // 凶手：投给嫌疑最高的人（转移注意力）或随机
    const nonMurderers = alivePlayers.filter((p) => !p.character.isMurderer);
    target = nonMurderers[Math.floor(Math.random() * nonMurderers.length)] ?? alivePlayers[0];
  } else {
    // 其他玩家：投给嫌疑最高的人
    const suspicious = alivePlayers.sort((a, b) => b.suspicionLevel - a.suspicionLevel);
    target = suspicious[0] ?? alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
  }

  return { playerId: player.playerId, targetId: target.playerId };
}

/** 检查游戏是否结束 */
export function checkMysteryEnd(state: MysteryGameState): boolean {
  return state.phase === 'reveal';
}

/** 获取玩家可见信息 */
export function getPlayerView(state: MysteryGameState, playerId: string | null) {
  const me = state.players.find((p) => p.playerId === playerId);
  const finished = state.phase === 'reveal';
  if (!me && !finished) {
    // 观众且未结束：只看公开信息
    return {
      format: state.format,
      phase: state.phase,
      round: state.round,
      game: 'murder_mystery',
      victim: state.victim,
      crimeScene: state.crimeScene,
      murderWeapon: '???',
      discoveredClues: state.clues.filter((c) => state.discoveredClues.includes(c.id)),
      discussionLog: state.discussionLog,
      voteStatus: state.voteStatus,
      votes: state.phase === 'voting' ? {} : state.votes,
      players: state.players.map((p) => ({
        playerId: p.playerId,
        nickname: p.nickname,
        character: { name: p.character.name, role: p.character.role },
        isAlive: p.isAlive,
      })),
      winner: state.winner,
      events: state.events,
    };
  }

  return {
    format: state.format,
    phase: state.phase,
    round: state.round,
    game: 'murder_mystery',
    victim: state.victim,
    crimeScene: state.crimeScene,
    murderWeapon: finished ? state.murderWeapon : me?.character.isMurderer ? state.murderWeapon : '???',
    myCharacter: me?.character,
    discoveredClues: state.clues.filter((c) => state.discoveredClues.includes(c.id)),
    totalClueCount: state.clues.length,
    discussionLog: state.discussionLog,
    voteStatus: state.voteStatus,
    votes: state.phase === 'voting' ? {} : state.votes,
    players: state.players.map((p) => ({
      playerId: p.playerId,
      nickname: p.nickname,
      character: {
        name: p.character.name,
        role: p.character.role,
        personality: p.character.personality,
        isMurderer: finished ? p.character.isMurderer : undefined,
      },
      isAlive: p.isAlive,
      isMe: p.playerId === playerId,
      hasSpoken: p.hasSpoken,
      hasSearched: p.hasSearched,
    })),
    murdererId: finished ? state.murdererId : undefined,
    accusedMurdererId: state.accusedMurdererId,
    winner: state.winner,
    events: state.events,
  };
}
