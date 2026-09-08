import type {
  MysteryGameState,
  MysteryPlayerState,
  CharacterCard,
  ClueCard,
  DiscussionEntry,
} from './mystery-types';
import { MYSTERY_SCENARIOS, CHARACTER_POOL, CLUE_POOL } from './mystery-types';

const pick = <T>(list: T[]): T | undefined =>
  list.length > 0 ? list[Math.floor(Math.random() * list.length)] : undefined;

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
  const aliveOthers = getAlivePlayers(state).filter((p) => p.playerId !== player.playerId);

  // ---- 公共辅助：构建上下文 ----
  const discoveredNames = state.discoveredClues.map((id) => {
    const c = state.clues.find((cl) => cl.id === id);
    return c ? c.name : id;
  });
  const recentDiscussions = state.discussionLog.filter((d) => d.playerId !== player.playerId).slice(-4);
  const highSuspicion = aliveOthers.filter((p) => p.suspicionLevel > 0).sort((a, b) => b.suspicionLevel - a.suspicionLevel);
  const topSuspect = highSuspicion[0];

  // ---- 自我介绍阶段 ----
  if (type === 'introduction') {
    const openerTemplates = isMurderer
      ? [
          `我是${character.name}，${character.backstory.slice(0, 30)}……关于今晚的事，我会配合调查。`,
          `诸位好，我是${character.name}，${character.role}。${character.backstory.slice(0, 25)}……愿真相大白。`,
          `我是${character.name}，${character.backstory.slice(0, 30)}……希望今晚能平安度过。`,
        ]
      : [
          `我是${character.name}，${character.role}。${character.backstory.slice(0, 30)}……我会尽力协助查明真相。`,
          `各位好，我是${character.name}，${character.relationshipToVictim}`,
          `我是${character.name}，${character.role}。${character.backstory.slice(0, 30)}……我对这起案件十分痛心。`,
        ];
    return pick(openerTemplates)!;
  }

  // ---- 调查/讨论阶段 ----
  if (type === 'investigation' || type === 'discussion') {
    if (isMurderer) {
      // 凶手策略：保持冷静、引导怀疑方向
      if (topSuspect && topSuspect.playerId !== player.playerId) {
        return `我注意到 ${topSuspect.nickname}（${topSuspect.character.name}）的反应有些不对劲，大家不妨听听 ${topSuspect.nickname} 的解释。`;
      }
      if (recentDiscussions.length > 0) {
        const last = recentDiscussions[recentDiscussions.length - 1]!;
        return `我同意 ${last.playerName}（${last.characterName}）的看法，我们需要更多证据而不是猜测。`;
      }
      const evadeTemplates = [
        `我认为现在下结论太早了，${character.personality}，我需要看到更多事实。`,
        `这件事没那么简单，希望大家不要被别人带节奏。`,
        `根据我的经验，真正的凶手往往擅长伪装成受害者的样子。`,
      ];
      return pick(evadeTemplates)!;
    }

    // 非凶手：结合线索和讨论
    if (discoveredNames.length > 0 && Math.random() < 0.6) {
      const keyClue = discoveredNames.find((n) => state.clues.find((c) => c.name === n)?.isKey);
      const clueName = keyClue ?? discoveredNames[discoveredNames.length - 1]!;
      const clue = state.clues.find((c) => c.name === clueName);
      if (clue && topSuspect) {
        return `我们发现的关键线索【${clueName}】：${clue.revealsInfo.slice(0, 40)}……我觉得这与 ${topSuspect.nickname}（${topSuspect.character.name}）有关，大家怎么认为？`;
      }
      if (clue) {
        return `线索【${clueName}】揭示了：${clue.revealsInfo}，请大家仔细分析这条线索的含义。`;
      }
    }
    if (topSuspect && Math.random() < 0.5) {
      return `从目前的线索来看，${topSuspect.nickname}（${topSuspect.character.name}）的嫌疑最大，${topSuspect.character.alibi}似乎站不住脚。`;
    }
    if (recentDiscussions.length > 0) {
      const last = recentDiscussions[recentDiscussions.length - 1]!;
      return `我注意到 ${last.playerName}（${last.characterName}）提到"${last.content.slice(0, 30)}…"，这点很有趣。`;
    }
    const generalTemplates = [
      `根据${character.personality}的观察，我觉得案情还有隐藏的细节。`,
      `${character.secret} 也许这是解开谜题的关键。`,
      `我们应该逐一排查每个人的不在场证明，${character.alibi}可以作为参考。`,
      `真相往往隐藏在细节中，我注意到一些之前被忽略的地方。`,
    ];
    return pick(generalTemplates)!;
  }

  // ---- 指控阶段 ----
  if (type === 'accusation') {
    if (isMurderer) {
      // 凶手嫁祸：优先选高嫌疑且非凶手的人
      const candidates = aliveOthers.filter((p) => !p.character.isMurderer).sort((a, b) => b.suspicionLevel - a.suspicionLevel);
      const target = candidates[0] ?? aliveOthers[0];
      if (target) {
        return `我指控${target.nickname}（${target.character.name}）！${target.character.alibi} 这个不在场证明完全站不住脚！`;
      }
      return `我觉得${aliveOthers[0]?.nickname}（${aliveOthers[0]?.character.name}）非常可疑！`;
    } else {
      // 侦探：基于线索和嫌疑投票
      if (topSuspect) {
        return `根据我们收集的所有线索，我指控${topSuspect.nickname}（${topSuspect.character.name}）是凶手！`;
      }
      if (discoveredNames.length > 0) {
        const keyClue = discoveredNames.find((n) => state.clues.find((c) => c.name === n)?.isKey);
        if (keyClue) {
          return `关键线索【${keyClue}】指向了重要信息，但我还需要更多时间来确认凶手身份。`;
        }
      }
      return `我还在调查中，请大家再给我一点时间。`;
    }
  }

  return '';
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
    // 凶手：优先嫁祸高嫌疑的非凶手玩家
    const nonMurderers = alivePlayers.filter((p) => !p.character.isMurderer);
    const sorted = [...nonMurderers].sort((a, b) => b.suspicionLevel - a.suspicionLevel);
    target = sorted[0] ?? nonMurderers[Math.floor(Math.random() * nonMurderers.length)] ?? alivePlayers[0];
  } else {
    // 好人：根据线索和嫌疑推理
    // 检查是否有关键线索指向某嫌疑人
    const keyClue = state.clues.find((c) => c.isKey && state.discoveredClues.includes(c.id));
    if (keyClue) {
      // 关键线索发现后，优先投给最高嫌疑
      const sorted = [...alivePlayers].sort((a, b) => b.suspicionLevel - a.suspicionLevel);
      target = sorted[0] ?? alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    } else {
      // 没有关键线索，按嫌疑投票
      const sorted = [...alivePlayers].sort((a, b) => b.suspicionLevel - a.suspicionLevel);
      target = sorted[0] ?? alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    }
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
