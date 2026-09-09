import type {
  MysteryGameState,
  MysteryPlayerState,
  CharacterCard,
  ClueCard,
  DiscussionEntry,
  MysteryScenario,
} from './mystery-types';
import { MYSTERY_SCENARIOS } from './mystery-types';

const pick = <T>(list: T[]): T | undefined =>
  list.length > 0 ? list[Math.floor(Math.random() * list.length)] : undefined;

/** 分配角色（使用指定剧本的专属角色池） */
export function assignMysteryRoles(
  playerIds: string[],
  scenario: MysteryScenario,
): { characters: Record<string, CharacterCard>; murdererId: string; policeId: string } {
  // 从剧本角色池中打乱后选取与玩家数相等的角色（若不够则循环取用）
  const shuffledChars = [...scenario.characters].sort(() => Math.random() - 0.5);

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
      // 凶手的秘密与目标与非凶手不同，且包含具体剧本信息
      secret: isMurderer
        ? `你就是杀害${scenario.victim}的凶手！凶器是${scenario.murderWeapon}。洗清嫌疑，嫁祸他人。`
        : charTemplate.secret,
      // 凶手的任务：隐藏身份逃脱；普通角色：完成卡上的个人任务
      objectives: isMurderer
        ? [
            { type: 'hide_secret' as const, description: '隐藏凶手身份，不被投票出局', reward: '成功逃脱', isComplete: false },
            { type: 'frame_someone' as const, description: '成功嫁祸一名其他玩家', reward: '额外积分', isComplete: false },
          ]
        : charTemplate.objectives,
    };
    characters[playerId] = character;
    if (isMurderer) murdererId = playerId;
  });

  // 分配警察：优先选择角色职业含"警/探/捕/刑警"的非凶手玩家，否则随机选一个非凶手
  const nonMurdererIds = playerIds.filter((id) => id !== murdererId);
  let policeId = nonMurdererIds.find((id) =>
    /警|探|捕|刑警/.test(characters[id].role),
  );
  if (!policeId) {
    policeId = nonMurdererIds[Math.floor(Math.random() * nonMurdererIds.length)];
  }
  characters[policeId].isPolice = true;

  // 20% 概率警察与凶手勾结（黑警）
  const isCorrupt = Math.random() < 0.2;
  characters[policeId].isCorrupt = isCorrupt;
  if (isCorrupt) {
    characters[policeId].secret += '\n【隐藏身份】你已被凶手收买，将暗中帮助凶手逃脱指控，但最终你也难逃法网。';
    characters[policeId].objectives = [
      { type: 'hide_secret' as const, description: '表面破案，实则保护凶手不被指认', reward: '凶手分赃', isComplete: false },
      { type: 'escape' as const, description: '确保自己不被怀疑，安全脱身', reward: '全身而退', isComplete: false },
    ];
  }

  return { characters, murdererId, policeId };
}

/** 初始化游戏状态 */
export function initMysteryState(
  players: { playerId: string; nickname: string }[],
): MysteryGameState {
  // 先选剧本，再用剧本自带的角色和线索
  const scenario = MYSTERY_SCENARIOS[Math.floor(Math.random() * MYSTERY_SCENARIOS.length)];
  const { characters, murdererId, policeId } = assignMysteryRoles(players.map((p) => p.playerId), scenario);

  const playerStates: MysteryPlayerState[] = players.map((p) => ({
    playerId: p.playerId,
    nickname: p.nickname,
    character: characters[p.playerId],
    isAlive: true,
    hasSpoken: false,
    hasSearched: false,
    votes: 0,
    suspicionLevel: 0,
    completedObjectives: [],
  }));

  // 使用剧本自带的线索（打乱顺序，取 4-6 条）
  const shuffledClues = [...scenario.clues].sort(() => Math.random() - 0.5);
  const clueCount = Math.min(4 + Math.floor(Math.random() * 3), shuffledClues.length);
  const clues: ClueCard[] = shuffledClues.slice(0, clueCount).map((c) => ({
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
    policeId,
    clues,
    discoveredClues: [],
    discussionLog: [],
    votes: {},
    voteStatus: {},
    scenarioTitle: scenario.title,
    events: [
      {
        id: crypto.randomUUID(),
        round: 1,
        phase: 'introduction',
        type: 'game_start',
        content: `剧本杀《${scenario.title}》开始！${scenario.synopsis}本案由${characters[policeId].name}负责调查。凶手就在你们之中，每轮投票若未揪出凶手，被投出者将出局，直到找出真凶或只剩凶手与一名无辜者……`,
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

/** 进入下一轮：重置状态，进入搜证阶段 */
export function nextMysteryRound(state: MysteryGameState): MysteryGameState {
  const next = structuredClone(state);
  next.round += 1;
  next.phase = 'investigation';
  next.votes = {};
  next.voteStatus = {};
  next.accusedMurdererId = undefined;
  for (const p of next.players) {
    p.hasSpoken = false;
    p.hasSearched = false;
    p.votes = 0;
  }
  next.events.push({
    id: crypto.randomUUID(),
    round: next.round,
    phase: 'investigation',
    type: 'phase_change',
    content: `第 ${next.round} 轮开始，进入搜证阶段。请各位继续调查${next.victim}被害的真相。`,
    timestamp: Date.now(),
  });
  return next;
}

/** 检查是否只剩凶手和一名非警察（凶手获胜条件） */
function checkMurdererWin(state: MysteryGameState): boolean {
  const alive = getAlivePlayers(state);
  const aliveMurderer = alive.filter((p) => p.character.isMurderer);
  const aliveNonPolice = alive.filter((p) => !p.character.isMurderer && !p.character.isPolice);
  // 凶手存活 且 非警察平民只剩 1 人 → 凶手胜利（成功隐藏）
  return aliveMurderer.length === 1 && aliveNonPolice.length <= 1;
}

/** 结算投票（多轮制：未找出凶手则淘汰被投者，进入下一轮） */
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

  // 平票或无人投票 → 本轮无人出局，直接进入下一轮
  if (tie || !accused || maxVotes === 0) {
    next.events.push({
      id: crypto.randomUUID(),
      round: next.round,
      phase: 'voting',
      type: 'vote_result',
      content: tie ? '投票平票！本轮无人出局，继续调查。' : '无人投票！本轮无人出局，继续调查。',
      timestamp: Date.now(),
    });
    return nextMysteryRound(next);
  }

  // 有人被投出
  next.accusedMurdererId = accused;
  const accusedPlayer = next.players.find((p) => p.playerId === accused);
  const isCorrect = accused === next.murdererId;

  if (isCorrect) {
    // 投出真凶 → 好人胜利
    next.events.push({
      id: crypto.randomUUID(),
      round: next.round,
      phase: 'voting',
      type: 'vote_result',
      actorName: accusedPlayer?.nickname,
      characterName: accusedPlayer?.character.name,
      content: `${accusedPlayer?.nickname}（${accusedPlayer?.character.name}）被指控为凶手！指控正确！真相大白。`,
      timestamp: Date.now(),
    });
    next.winner = 'detectives';
    next.phase = 'reveal';
    return next;
  }

  // 投错了 → 淘汰被投者，进入下一轮
  if (accusedPlayer) {
    accusedPlayer.isAlive = false;
    accusedPlayer.suspicionLevel += 3;
  }
  next.events.push({
    id: crypto.randomUUID(),
    round: next.round,
    phase: 'voting',
    type: 'vote_result',
    actorName: accusedPlayer?.nickname,
    characterName: accusedPlayer?.character.name,
    content: `${accusedPlayer?.nickname}（${accusedPlayer?.character.name}）被投票出局，但TA不是凶手！真凶仍藏匿其中，调查继续……`,
    timestamp: Date.now(),
  });

  // 检查凶手胜利条件：只剩凶手 + 1 名非警察
  if (checkMurdererWin(next)) {
    const murdererPlayer = next.players.find((p) => p.character.isMurderer);
    next.events.push({
      id: crypto.randomUUID(),
      round: next.round,
      phase: 'voting',
      type: 'vote_result',
      content: `存活玩家仅剩凶手与一名无辜者，${murdererPlayer?.character.name}成功隐藏身份，暂时逃脱了法律制裁……`,
      timestamp: Date.now(),
    });
    next.winner = 'murderer';
    next.phase = 'reveal';
    return next;
  }

  // 否则进入下一轮
  return nextMysteryRound(next);
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
  const victim = state.victim;
  const weapon = state.murderWeapon;

  // ---- 公共辅助：构建上下文 ----
  const discoveredClueObjs = state.clues.filter((c) => state.discoveredClues.includes(c.id));
  const keyClues = discoveredClueObjs.filter((c) => c.isKey);
  const recentDiscussions = state.discussionLog.filter((d) => d.playerId !== player.playerId).slice(-4);
  const highSuspicion = aliveOthers.filter((p) => p.suspicionLevel > 0).sort((a, b) => b.suspicionLevel - a.suspicionLevel);
  const topSuspect = highSuspicion[0];

  // ---- 自我介绍阶段 ----
  if (type === 'introduction') {
    if (isMurderer) {
      const openerTemplates = [
        `我是${character.name}，${character.role}。${character.backstory.slice(0, 35)}……关于${victim}的事，我深感遗憾，会全力配合调查。`,
        `诸位好，我是${character.name}。${character.backstory.slice(0, 30)}……愿${victim}的在天之灵能早日安息。`,
        `我是${character.name}，${character.role}。${character.backstory.slice(0, 30)}……我也想知道，到底是谁对${victim}下了毒手。`,
      ];
      return pick(openerTemplates)!;
    }
    const openerTemplates = [
      `我是${character.name}，${character.role}。${character.backstory.slice(0, 35)}……我会尽力协助查明${victim}被害的真相。`,
      `各位好，我是${character.name}，${character.relationshipToVictim}对于${victim}的离世，我非常悲痛。`,
      `我是${character.name}，${character.role}。${character.backstory.slice(0, 30)}……我一定要找出杀害${victim}的凶手。`,
    ];
    return pick(openerTemplates)!;
  }

  // ---- 调查/讨论阶段 ----
  if (type === 'investigation' || type === 'discussion') {
    if (isMurderer) {
      // 凶手策略：保持冷静、引导怀疑方向、尽量不谈凶器
      if (topSuspect && topSuspect.playerId !== player.playerId) {
        const frameLines = [
          `我注意到 ${topSuspect.character.name} 刚才的反应有些不对劲，关于${victim}的事，${topSuspect.character.name}是不是知道些什么？`,
          `大家有没有觉得 ${topSuspect.character.name} 一直在回避问题？${topSuspect.character.name} 的不在场证明"${topSuspect.character.alibi}"真的可靠吗？`,
          `我觉得 ${topSuspect.character.name} 的嫌疑很大，${victim}出事前，${topSuspect.character.name}是不是和${victim}有过接触？`,
        ];
        return pick(frameLines)!;
      }
      if (recentDiscussions.length > 0) {
        const last = recentDiscussions[recentDiscussions.length - 1]!;
        return `我同意 ${last.characterName} 的看法，关于${victim}的案子，我们需要更多${weapon}以外的证据，不能光靠猜测。`;
      }
      const evadeTemplates = [
        `我认为现在下结论太早了，${victim}的案子没那么简单，大家不要被表面现象迷惑。`,
        `这件事没那么简单，希望大家不要被别人带节奏，${victim}的死一定另有隐情。`,
        `根据我的经验，真正的凶手往往最擅长伪装，大家不要轻易怀疑一个看起来无辜的人。`,
      ];
      return pick(evadeTemplates)!;
    }

    // 非凶手：结合线索和讨论推理
    if (discoveredClueObjs.length > 0 && Math.random() < 0.6) {
      const clue = pick(keyClues) ?? discoveredClueObjs[discoveredClueObjs.length - 1]!;
      if (clue && topSuspect) {
        return `我们发现的${clue.isKey ? '关键' : ''}线索【${clue.name}】：${clue.revealsInfo.slice(0, 50)}……我觉得这与 ${topSuspect.character.name} 有关，大家怎么认为？`;
      }
      if (clue) {
        return `线索【${clue.name}】揭示了：${clue.revealsInfo}，请大家仔细分析这条线索与${victim}之死的关系。`;
      }
    }
    if (topSuspect && Math.random() < 0.5) {
      return `从目前的线索来看，${topSuspect.character.name} 的嫌疑最大，"${topSuspect.character.alibi}"这个不在场证明似乎站不住脚，而且${topSuspect.character.name}与${victim}的关系是"${topSuspect.character.relationshipToVictim}"。`;
    }
    if (recentDiscussions.length > 0 && Math.random() < 0.4) {
      const last = recentDiscussions[recentDiscussions.length - 1]!;
      return `我注意到 ${last.characterName} 提到"${last.content.slice(0, 35)}…"，关于${victim}的案子，这点很值得深入思考。`;
    }
    // 引用自己的秘密（暗示性）
    if (Math.random() < 0.3) {
      return `${character.secret.slice(0, 45)}……我觉得这可能与${victim}的案子有关。`;
    }
    const generalTemplates = [
      `根据${character.personality}的观察，我觉得${victim}的案子还有隐藏的细节，尤其是关于${weapon}的来源。`,
      `我们应该逐一排查每个人与${victim}的关系，"${character.relationshipToVictim}"，每个人都有动机的可能。`,
      `真相往往隐藏在细节中，关于${victim}的死，我注意到一些之前被忽略的地方。`,
      `${victim}出事前，有没有人注意到什么异常？我觉得${weapon}这个凶器值得深究。`,
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
        const accuseLines = [
          `我指控${target.character.name}！${target.character.name}与${victim}的关系是"${target.character.relationshipToVictim}"，有充分的作案动机！`,
          `凶手就是${target.character.name}！"${target.character.alibi}"这个不在场证明完全站不住脚，而且${weapon}上一定有${target.character.name}的痕迹！`,
          `我认定${target.character.name}就是杀害${victim}的凶手，请大家把票投给${target.character.name}！`,
        ];
        return pick(accuseLines)!;
      }
      return `我觉得${aliveOthers[0]?.character.name}非常可疑，${victim}一定是${aliveOthers[0]?.character.name}杀的！`;
    }
    // 好人：基于线索和嫌疑投票
    if (topSuspect) {
      if (keyClues.length > 0) {
        return `根据关键线索【${keyClues[0]!.name}】和目前的嫌疑，我指控${topSuspect.character.name}是杀害${victim}的凶手！`;
      }
      return `根据我们收集的所有线索，我指控${topSuspect.character.name}是凶手！${weapon}上一定有${topSuspect.character.name}的痕迹！`;
    }
    if (keyClues.length > 0) {
      return `关键线索【${keyClues[0]!.name}】指向了重要信息，但我还需要更多时间来确认凶手身份。`;
    }
    return `我还在调查中，但${victim}的案子一定有隐情，请大家再给我一点时间。`;
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
  const isCorruptPolice = character.isPolice && character.isCorrupt;
  const alivePlayers = getAlivePlayers(state).filter((p) => p.playerId !== player.playerId);

  if (alivePlayers.length === 0) {
    return { playerId: player.playerId, targetId: player.playerId };
  }

  let target: MysteryPlayerState;

  if (isMurderer || isCorruptPolice) {
    // 凶手 / 黑警：优先嫁祸高嫌疑的非凶手玩家（保护真凶）
    const nonMurderers = alivePlayers.filter((p) => !p.character.isMurderer);
    // 黑警不投凶手；凶手不自投
    const safeTargets = nonMurderers.filter((p) => p.playerId !== state.murdererId);
    const sorted = [...(safeTargets.length > 0 ? safeTargets : nonMurderers)].sort(
      (a, b) => b.suspicionLevel - a.suspicionLevel,
    );
    target = sorted[0] ?? nonMurderers[Math.floor(Math.random() * nonMurderers.length)] ?? alivePlayers[0];
  } else {
    // 好人（含正直警察）：根据线索和嫌疑推理
    const keyClue = state.clues.find((c) => c.isKey && state.discoveredClues.includes(c.id));
    const sorted = [...alivePlayers].sort((a, b) => b.suspicionLevel - a.suspicionLevel);
    if (keyClue) {
      // 关键线索发现后，优先投给最高嫌疑
      target = sorted[0] ?? alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    } else {
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
      scenarioTitle: state.scenarioTitle,
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
        isPolice: p.character.isPolice,
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
    scenarioTitle: state.scenarioTitle,
    victim: state.victim,
    crimeScene: state.crimeScene,
    murderWeapon: finished ? state.murderWeapon : me?.character.isMurderer ? state.murderWeapon : '???',
    policeId: state.policeId,
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
        isPolice: p.character.isPolice,
        isCorrupt: finished ? p.character.isCorrupt : undefined,
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
