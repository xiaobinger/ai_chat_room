import type {
  MysteryGameState,
  MysteryPlayerState,
  CharacterCard,
  ClueCard,
  DiscussionEntry,
  MysteryScenario,
  ConflictEvent,
  PlotTwist,
  LatecomerProfile,
  MysteriousCharacterTemplate,
} from './mystery-types';
import { MYSTERY_SCENARIOS, MYSTERIOUS_CHARACTER_POOL } from './mystery-types';

/** 从神秘人物模板池随机抽取一个未在本次登场的角色 */
function pickMysteriousCharacter(usedNames: Set<string>): MysteriousCharacterTemplate | undefined {
  const available = MYSTERIOUS_CHARACTER_POOL.filter((t) => !usedNames.has(t.role));
  if (available.length === 0) return undefined;
  return available[Math.floor(Math.random() * available.length)];
}

const pick = <T>(list: T[]): T | undefined =>
  list.length > 0 ? list[Math.floor(Math.random() * list.length)] : undefined;

function getSeatNumber(state: MysteryGameState, playerId: string): number | null {
  const index = state.players.findIndex((player) => player.playerId === playerId);
  return index >= 0 ? index + 1 : null;
}

function clueImplicationScore(clue: ClueCard, player: MysteryPlayerState): number {
  // 已被揭穿的伪证不再计入嫌疑推理（揭穿前会正常误导——包括 AI）
  if (clue.isFabricated && clue.isFabricationExposed) return 0;
  const haystack = `${clue.name} ${clue.description} ${clue.revealsInfo} ${clue.location}`;
  let score = 0;
  if (haystack.includes(player.character.name)) score += 3;
  if (haystack.includes(player.character.relationshipToVictim)) score += 2;
  const alibiKeywords = player.character.alibi
    .split(/[，。；、,\s]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
  if (alibiKeywords.some((keyword) => haystack.includes(keyword))) score += 1;
  return score;
}

function discussionPressureScore(state: MysteryGameState, player: MysteryPlayerState): number {
  return state.discussionLog.reduce((score, entry) => {
    if (entry.playerId === player.playerId) return score;
    if (entry.content.includes(player.character.name) || entry.content.includes(player.nickname)) {
      return score + (entry.type === 'accusation' ? 2 : 1);
    }
    return score;
  }, 0);
}

function observationPressureScore(state: MysteryGameState, player: MysteryPlayerState): number {
  return state.observations
    .filter((observation) => observation.targetId === player.playerId)
    .reduce((score, observation) => score + Math.max(0, observation.suspicionDelta), 0);
}

function mysteryPublicScore(state: MysteryGameState, player: MysteryPlayerState): number {
  const discoveredClues = state.clues.filter((clue) => state.discoveredClues.includes(clue.id));
  const clueScore = discoveredClues.reduce((score, clue) => score + clueImplicationScore(clue, player), 0);
  return player.suspicionLevel * 2 + discussionPressureScore(state, player) + observationPressureScore(state, player) + clueScore;
}

function rankMysterySuspects(state: MysteryGameState, excludePlayerId?: string): MysteryPlayerState[] {
  return getAlivePlayers(state)
    .filter((player) => player.playerId !== excludePlayerId)
    .sort((a, b) => mysteryPublicScore(state, b) - mysteryPublicScore(state, a));
}

function mentionedInPublicNotes(state: MysteryGameState, player: MysteryPlayerState): number {
  return state.publicNotes.reduce((score, note) => (note.content.includes(player.character.name) ? score + 1 : score), 0);
}

function interpersonalPressureScore(
  state: MysteryGameState,
  observer: MysteryPlayerState,
  target: MysteryPlayerState,
): number {
  return state.discussionLog.reduce((score, entry) => {
    if (entry.playerId !== target.playerId) return score;
    if (entry.content.includes(observer.character.name) || entry.content.includes(observer.nickname)) return score + 1;
    return score;
  }, 0);
}

function mysteryPersonalityBias(
  state: MysteryGameState,
  observer: MysteryPlayerState,
  target: MysteryPlayerState,
): number {
  const personality = observer.character.personality;
  const discoveredClues = state.clues.filter((clue) => state.discoveredClues.includes(clue.id));
  const clueScore = discoveredClues.reduce((score, clue) => score + clueImplicationScore(clue, target), 0);
  let score = 0;

  if (/谨慎|冷静|细心|敏锐|理性|观察|精明|专业|沉稳|博学/.test(personality)) {
    score += clueScore + observationPressureScore(state, target);
  }
  if (/豪爽|直率|暴躁|果断|威严|强势|阴郁/.test(personality)) {
    score += discussionPressureScore(state, target) + interpersonalPressureScore(state, observer, target) * 2;
  }
  if (/敏感|温柔|胆小|内向|善良|忧郁/.test(personality)) {
    score += target.suspicionLevel + mentionedInPublicNotes(state, target);
  }
  return score;
}

function rankMysterySuspectsForPlayer(state: MysteryGameState, observer: MysteryPlayerState): MysteryPlayerState[] {
  return getAlivePlayers(state)
    .filter((player) => player.playerId !== observer.playerId)
    .sort((a, b) => {
      const scoreB = mysteryPublicScore(state, b) + mysteryPersonalityBias(state, observer, b);
      const scoreA = mysteryPublicScore(state, a) + mysteryPersonalityBias(state, observer, a);
      return scoreB - scoreA;
    });
}

function mysterySpeechLead(character: CharacterCard): string {
  const personality = character.personality;
  if (/豪爽|直率|暴躁|果断|威严|强势/.test(personality)) return '我先把结论说在前面，';
  if (/谨慎|冷静|细心|敏锐|理性|观察|沉稳|专业/.test(personality)) return '我先按线索慢慢说，';
  if (/敏感|温柔|胆小|内向|善良|忧郁/.test(personality)) return '我想先把我看到的细节说明白，';
  return '';
}

function rememberPublicNote(state: MysteryGameState, content: string): void {
  const trimmed = content.trim();
  if (!trimmed) return;
  const last = state.publicNotes[state.publicNotes.length - 1];
  if (last?.content === trimmed && last.round === state.round) return;
  state.publicNotes.push({ round: state.round, content: trimmed });
}

export function summarizeMysteryPublicNote(state: MysteryGameState): string | undefined {
  const suspects = rankMysterySuspects(state);
  const top = suspects[0];
  const keyClues = state.clues.filter((clue) => clue.isKey && state.discoveredClues.includes(clue.id));
  if (top && keyClues.length > 0) {
    return `当前最受怀疑的是 ${top.character.name}，关键线索与TA的说法已经开始出现冲突。`;
  }
  if (top) {
    return `当前嫌疑最集中的人物是 ${top.character.name}，接下来要重点核对TA的动机与不在场证明。`;
  }
  if (keyClues.length > 0) {
    return '关键线索已经出现，但场上还没有形成统一怀疑对象。';
  }
  return undefined;
}

/** 分配角色（使用指定剧本的专属角色池，绝不重复；剩余角色进入彩蛋池供中途空降） */
export function assignMysteryRoles(
  playerIds: string[],
  scenario: MysteryScenario,
): { characters: Record<string, CharacterCard>; murdererId: string; policeId: string; accompliceId?: string; latecomerChars: Omit<CharacterCard, 'id' | 'isMurderer' | 'isAccomplice' | 'isPolice' | 'isCorrupt'>[] } {
  // 角色必须够分，否则抛出（由调用方确保选择够角色的剧本）
  if (scenario.characters.length < playerIds.length) {
    throw new Error(`剧本角色不足：需要 ${playerIds.length} 个，剧本只有 ${scenario.characters.length} 个`);
  }
  // 打乱后选取与玩家数相等的角色（不取模，保证不重复），剩余角色进入彩蛋池
  const shuffledChars = [...scenario.characters].sort(() => Math.random() - 0.5).slice(0, playerIds.length);
  const latecomerChars = [...scenario.characters].sort(() => Math.random() - 0.5).slice(playerIds.length);

  const characters: Record<string, CharacterCard> = {};
  let murdererId = '';

  // 随机选择一名玩家作为凶手
  const murdererIndex = Math.floor(Math.random() * playerIds.length);

  playerIds.forEach((playerId, index) => {
    const charTemplate = shuffledChars[index];
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

  // 帮凶机制：5 人及以上 45% 概率出现（与黑警互斥——一局只有一种"内鬼"配置）
  // 帮凶知道凶手身份，任务是搅乱调查、掩护真凶；被投出时身份揭穿但游戏不结束
  let accompliceId: string | undefined;
  if (playerIds.length >= 5 && Math.random() < 0.45) {
    const accompliceCandidates = nonMurdererIds.filter((id) => id !== policeId);
    if (accompliceCandidates.length > 0) {
      accompliceId = accompliceCandidates[Math.floor(Math.random() * accompliceCandidates.length)];
      characters[accompliceId].isAccomplice = true;
      characters[accompliceId].secret += `\n【隐藏身份】你是凶手的帮凶！真凶是${characters[murdererId].name}。你的任务是不动声色地搅乱调查、把怀疑引向无辜的人，绝不能暴露自己与TA的关系。`;
      characters[accompliceId].objectives = [
        { type: 'hide_secret' as const, description: '隐藏帮凶身份，掩护真凶不被指认', reward: '共谋得逞', isComplete: false },
        { type: 'frame_someone' as const, description: '把怀疑成功引向一名无辜者', reward: '额外积分', isComplete: false },
      ];
    }
  }

  // 黑警仅在无帮凶时 20% 概率出现（避免一局双内鬼过乱）
  if (!accompliceId && Math.random() < 0.2) {
    characters[policeId].isCorrupt = true;
    characters[policeId].secret += '\n【隐藏身份】你已被凶手收买，将暗中帮助凶手逃脱指控，但最终你也难逃法网。';
    characters[policeId].objectives = [
      { type: 'hide_secret' as const, description: '表面破案，实则保护凶手不被指认', reward: '凶手分赃', isComplete: false },
      { type: 'escape' as const, description: '确保自己不被怀疑，安全脱身', reward: '全身而退', isComplete: false },
    ];
  }

  return { characters, murdererId, policeId, accompliceId, latecomerChars };
}

/** 初始化游戏状态 */
export function initMysteryState(
  players: { playerId: string; nickname: string }[],
): MysteryGameState {
  // 先选剧本，再用剧本自带的角色和线索
  // 只从角色数 >= 玩家数的剧本中随机选择（避免角色不足）
  const eligibleScenarios = MYSTERY_SCENARIOS.filter((s) => s.characters.length >= players.length);
  const pool = eligibleScenarios.length > 0 ? eligibleScenarios : MYSTERY_SCENARIOS;
  const scenario = pool[Math.floor(Math.random() * pool.length)];
  const { characters, murdererId, policeId, accompliceId, latecomerChars } = assignMysteryRoles(
    players.map((p) => p.playerId),
    scenario,
  );

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

  // 证据链闭环：关键线索各占一环（手段/时机/动机/痕迹），集齐才能锁定真凶
  const CHAIN_STEPS: ClueCard['chainStep'][] = ['means', 'opportunity', 'motive', 'trace'];
  let chainIndex = 0;
  for (const clue of clues) {
    if (clue.isKey && chainIndex < CHAIN_STEPS.length) {
      clue.chainStep = CHAIN_STEPS[chainIndex]!;
      chainIndex++;
    }
  }

  // 凶手伪造的误导线索：从非关键线索里改造一条，表面指向无辜者（揭穿前计入嫌疑推理）
  const nonKeyClues = clues.filter((c) => !c.isKey);
  const frameTarget = playerStates.find(
    (p) => p.playerId !== murdererId && p.playerId !== policeId && p.playerId !== accompliceId,
  );
  if (nonKeyClues.length > 0 && frameTarget) {
    const fake = nonKeyClues[Math.floor(Math.random() * nonKeyClues.length)]!;
    fake.isFabricated = true;
    fake.fabricatedTo = frameTarget.character.name;
    fake.description = `${fake.description}（表面上看，这与${frameTarget.character.name}高度相关……）`;
    fake.revealsInfo = `种种迹象将矛头直接指向${frameTarget.character.name}——但这未经验证的推断，正在把调查带偏。`;
  }

  // 彩蛋入场池：剩余角色 + 未入场的剩余线索（角色入场时带来专属线索）
  const selectedClueNames = new Set(clues.map((c) => c.name));
  const unusedClues = [...scenario.clues.filter((c) => !selectedClueNames.has(c.name))];
  const latecomerPool: LatecomerProfile[] = latecomerChars.map((character) => {
    const spare = unusedClues.shift();
    return {
      character,
      arrivalClue: spare
        ? { ...spare }
        : {
            name: `${character.name}带来的证物`,
            description: `${character.name}随身携带的一份关键证物，上面残留着与案件相关的痕迹。`,
            location: '随身携带',
            revealsInfo: `${character.name}与${scenario.victim}之间有着此前无人知晓的关联。`,
            isKey: true,
          },
    };
  });

  // 随机引入神秘人物（60% 概率），从模板池选取不重复的角色
  const usedRoles = new Set([
    ...latecomerChars.map((c) => c.role),
    ...playerStates.map((p) => p.character.role),
  ]);
  if (Math.random() < 0.6) {
    const mysterious = pickMysteriousCharacter(usedRoles);
    if (mysterious) {
      const mystChar: CharacterCard = {
        id: `myst-${crypto.randomUUID()}`,
        name: `${mysterious.role}`,
        role: mysterious.role,
        personality: mysterious.personality,
        gender: mysterious.gender === 'unknown' ? undefined : mysterious.gender,
        age: mysterious.age,
        height: mysterious.height,
        weight: mysterious.weight,
        backstory: mysterious.backstory,
        secret: mysterious.secret,
        isMurderer: false,
        objectives: [{ type: 'find_truth', description: '完成你的秘密任务，但不要被其他人看穿。', reward: '真相', isComplete: false }],
        alibi: '案发时行踪不明，无法确认。',
        relationshipToVictim: '与死者之间有着不为人知的关联。',
        specialAbility: mysterious.specialAbility,
      };
      const spare = unusedClues.shift();
      latecomerPool.push({
        character: mystChar,
        arrivalClue: spare
          ? { ...spare }
          : {
              name: `${mysterious.role}的秘密档案`,
              description: `一份关于${mysterious.role}的封存档案，记录了其与案件的深层关联。`,
              location: '档案室',
              revealsInfo: `${mysterious.role}的出现并非偶然——TA掌握着破解本案的关键信息。`,
              isKey: true,
            },
      });
    }
  }

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
    accompliceId,
    latecomerPool,
    twists: [],
    clues,
    discoveredClues: [],
    discussionLog: [],
    votes: {},
    voteStatus: {},
    scenarioTitle: scenario.title,
    observations: [],
    secretChats: [],
    publicNotes: [{ round: 1, content: `案件开始：围绕 ${scenario.victim} 遇害一案，先确认关系网、动机和不在场证明。` }],
    conflictLevel: 0,
    conflictEvents: [],
    events: [
      {
        id: crypto.randomUUID(),
        round: 1,
        phase: 'introduction',
        type: 'game_start',
        content: `剧本杀《${scenario.title}》开始！${scenario.synopsis}本案由${characters[policeId].name}负责调查。凶手就在你们之中——但请记住：真相往往不止一层，证词可以被伪造，时间线可以被推翻，而凶手身边……也许还站着别人。每轮投票若未揪出凶手，被投出者将出局，直到找出真凶或只剩凶手与一名无辜者……`,
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

  // 讨论/指控阶段检测冲突
  if (next.phase === 'discussion' || next.phase === 'accusation') {
    const conflict = detectAndGenerateConflict(next, entry);
    if (conflict) {
      next.conflictEvents.push(conflict);
      next.conflictLevel = Math.min(100, next.conflictLevel + conflict.intensity * 0.4);
      next.events.push({
        id: crypto.randomUUID(),
        round: next.round,
        phase: next.phase,
        type: 'conflict',
        actorName: conflict.participants.map((p) => p.nickname).join(' vs '),
        content: conflict.description,
        timestamp: Date.now(),
      });
    }
  }

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

/**
 * 连续 3 轮平票僵局：按累计嫌疑度最高者强制指认，打破僵局。
 * 与谁是卧底的 resolveTiebreak 同一套兜底，返回被强制指认的 playerId。
 */
function resolveMysteryTiebreak(next: MysteryGameState): string | null {
  const count = next.consecutiveTies ?? 0;
  next.consecutiveTies = 0;
  const alive = next.players.filter((p) => p.isAlive);
  if (alive.length === 0) return null;
  const sorted = [...alive].sort(
    (a, b) => b.suspicionLevel - a.suspicionLevel || (a.nickname > b.nickname ? 1 : -1),
  );
  const target = sorted[0];
  rememberPublicNote(next, `连续 ${count} 轮平票，按累计嫌疑度强制指认 ${target.nickname}，避免调查无限拖延。`);
  next.events.push({
    id: crypto.randomUUID(),
    round: next.round,
    phase: 'voting',
    type: 'vote_result',
    content: `连续 ${count} 轮平票僵局！按累计嫌疑度强制指认 ${target.nickname}，本轮强制结算。`,
    timestamp: Date.now(),
  });
  return target.playerId;
}

/** 剧情反转：分轮次触发，颠覆此前推理共识（反转再反转的戏剧节奏） */
export function maybeTriggerTwist(state: MysteryGameState): PlotTwist | null {
  const triggeredKinds = new Set(state.twists.map((t) => t.kind));

  // 时间线推翻：第 2 轮开始时高概率触发——所有人的不在场证明瞬间失去价值
  if (state.round >= 2 && !triggeredKinds.has('timeline') && Math.random() < 0.8) {
    const twist: PlotTwist = {
      id: crypto.randomUUID(),
      round: state.round,
      kind: 'timeline',
      title: '尸检报告更新',
      content: `法医的补充鉴定推翻了此前的判断：${state.victim}的死亡时间比最初认定提前了整整两个小时！这意味着此前所有人的不在场证明全部失去效力——在真正的案发时刻，你们之中有人的"铁证"其实一文不值。`,
      timestamp: Date.now(),
    };
    state.twists.push(twist);
    state.timelineDisproved = true;
    // 嫌疑洗牌：此前依赖"不在场证明"的推理全部需要重来
    for (const player of state.players) {
      player.suspicionLevel = Math.max(0, player.suspicionLevel + Math.floor(Math.random() * 7) - 3);
    }
    return twist;
  }

  // 伪证揭穿：存在已发现且未揭穿的伪造线索时触发——反转"铁证"的可信度
  const fabricatedDiscovered = state.clues.find(
    (c) => c.isFabricated && !c.isFabricationExposed && state.discoveredClues.includes(c.id),
  );
  if (state.round >= 2 && fabricatedDiscovered && !triggeredKinds.has('fabricated_clue') && Math.random() < 0.7) {
    fabricatedDiscovered.isFabricationExposed = true;
    const framed = fabricatedDiscovered.fabricatedTo ?? '被指向的人';
    const twist: PlotTwist = {
      id: crypto.randomUUID(),
      round: state.round,
      kind: 'fabricated_clue',
      title: '伪证鉴定结果',
      content: `技术科对线索【${fabricatedDiscovered.name}】完成了深入鉴定——结论令人脊背发凉：这是凶手事后伪造的伪证！上面所有指向${framed}的痕迹都是人为布置的。也就是说，真凶一直在利用你们的推理习惯带节奏，${framed}的嫌疑应当被重新评估。`,
      revealedClueId: fabricatedDiscovered.id,
      timestamp: Date.now(),
    };
    state.twists.push(twist);
    return twist;
  }

  // 动机反转：第 3 轮起触发——死者隐藏的秘密曝光，最可疑的人反而洗白
  if (state.round >= 3 && !triggeredKinds.has('motive') && Math.random() < 0.6) {
    const alive = getAlivePlayers(state);
    const mostSuspected = [...alive].sort((a, b) => b.suspicionLevel - a.suspicionLevel)[0];
    if (mostSuspected && mostSuspected.suspicionLevel > 0) {
      mostSuspected.suspicionLevel = Math.max(0, mostSuspected.suspicionLevel - 4);
    }
    const twist: PlotTwist = {
      id: crypto.randomUUID(),
      round: state.round,
      kind: 'motive',
      title: '死者的隐藏档案',
      content: `一封被藏起来的信件曝光了${state.victim}不为人知的另一面——TA生前欠下的债、撒过的谎，远比你们想象的更黑暗。此前被视作"头号嫌疑人"的动机链条出现了根本性动摇：有些"动机"其实是死者自己编织的假象。这桩案子，比表面看起来要深得多。`,
      timestamp: Date.now(),
    };
    state.twists.push(twist);
    return twist;
  }

  return null;
}

/** 彩蛋角色中途入场：剧本剩余角色带着新线索空降对局（NPC 玩家，参与搜证/发言/投票/被指认） */
export function addLatecomer(state: MysteryGameState): MysteryPlayerState | null {
  if (state.latecomerPool.length === 0) return null;
  const profile = state.latecomerPool.shift()!;

  const latecomerId = `npc-latecomer-${crypto.randomUUID().slice(0, 8)}`;
  const player: MysteryPlayerState = {
    playerId: latecomerId,
    nickname: profile.character.name,
    character: {
      ...profile.character,
      id: `char-${latecomerId}`,
      isMurderer: false,
    },
    isAlive: true,
    hasSpoken: false,
    hasSearched: false,
    votes: 0,
    suspicionLevel: 1,
    completedObjectives: [],
    isLatecomer: true,
    joinedRound: state.round,
  };
  state.players.push(player);

  // 入场自带的新线索加入线索池（可在搜证阶段被发现）
  state.clues.push({
    ...profile.arrivalClue,
    id: `clue-${crypto.randomUUID()}`,
  });

  const arrivalLines = [
    `【突发】大门被推开——一个所有人都没料到的人出现在众人面前："我是${profile.character.name}，${profile.character.role}。我知道今晚会出事……我带来了关于${state.victim}的关键信息。"`,
    `【突发】一条不为人知的小径上，${profile.character.name}（${profile.character.role}）冒雨赶到："别急着下结论。${state.victim}的死和三年前的旧事有关——而这个秘密，只有我知道。`,
    `【突发】${profile.character.name}推门而入，径直走向众人："${profile.character.backstory.slice(0, 40)}……我不在场，不代表我不了解真相。"`,
  ];
  const arrival = pick(arrivalLines)!;
  state.events.push({
    id: crypto.randomUUID(),
    round: state.round,
    phase: state.phase,
    type: 'latecomer',
    actorName: profile.character.name,
    characterName: profile.character.name,
    content: arrival,
    timestamp: Date.now(),
  });
  rememberPublicNote(state, `第 ${state.round} 轮出现变数：${profile.character.name}中途入场，携带着与${state.victim}有关的新线索，场上局势被重新洗牌。`);
  return player;
}

/** 进入下一轮：重置状态，进入搜证阶段（并按剧情节奏触发反转/彩蛋入场） */
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

  // 剧情反转：新轮开场颠覆此前的推理共识（反转再反转）
  const twist = maybeTriggerTwist(next);
  if (twist) {
    next.events.push({
      id: crypto.randomUUID(),
      round: next.round,
      phase: next.phase,
      type: 'twist',
      content: `【剧情反转·${twist.title}】${twist.content}`,
      timestamp: Date.now(),
    });
    next.conflictLevel = Math.min(100, next.conflictLevel + 18);
  }

  // 彩蛋入场：第 2 轮 65% 概率空降一名新角色；第 3 轮若从未入场则 40% 兜底
  const hasLatecomer = next.players.some((p) => p.isLatecomer);
  const latecomerChance = next.round === 2 ? 0.65 : next.round === 3 && !hasLatecomer ? 0.4 : 0;
  if (Math.random() < latecomerChance) {
    addLatecomer(next);
  }

  return next;
}

/** 情绪词强度权重 */
const EMOTION_BOOST: Record<string, number> = {
  凶手: 8, 骗我: 6, 撒谎: 7, 嫌疑: 6, 动机: 4, 证据: 5, 指认: 7, 控告: 7,
  杀害: 6, 毒药: 5, 凶器: 5, 尸体: 5, 血: 5, 谋杀: 6,
  闭嘴: 5, 住口: 4, 你敢: 5, 别想: 4, 滚: 3,
  我恨: 6, 你该死: 7, 杀了你: 8, 去死: 7,
  颤抖: 4, 发抖: 4, 愤怒: 5, 怒吼: 6, 咆哮: 7, 抓住: 5,
};

/** 计算发言的冲突强度贡献 */
function contributionOfEntry(state: MysteryGameState, entry: DiscussionEntry): number {
  let score = 0;
  // 发言类型加成
  if (entry.type === 'accusation') score += 5;
  else if (entry.type === 'defense') score -= 2;
  // 情绪词
  for (const [word, weight] of Object.entries(EMOTION_BOOST)) {
    if (entry.content.includes(word)) score += weight;
  }
  // 重复提及同一目标
  const mentioned = state.discussionLog.filter(
    (e) => e.playerId !== entry.playerId && (e.content.includes(entry.characterName) || e.content.includes(entry.playerId)),
  );
  score += mentioned.length * 2;
  // 发言长度（长发言通常更激烈）
  score += Math.min(entry.content.length / 50, 3);
  return Math.max(0, score);
}

/** 检测当前讨论中是否存在冲突机会并生成冲突事件 */
export function detectAndGenerateConflict(
  state: MysteryGameState,
  lastEntry: DiscussionEntry,
): ConflictEvent | null {
  const recentAccusations = state.discussionLog
    .filter((e) => e.type === 'accusation' && e.playerId !== lastEntry.playerId)
    .slice(-3);
  const recentDefs = state.discussionLog
    .filter((e) => e.type === 'defense' && e.playerId !== lastEntry.playerId)
    .slice(-3);

  // 只有在有指控且被指控方还在场时才会触发
  if (recentAccusations.length === 0) return null;

  const targetNames = new Set(recentAccusations.map((e) => e.characterName));
  const selfCharName = state.players.find((p) => p.playerId === lastEntry.playerId)?.character.name;
  if (!selfCharName) return null;
  // 如果这条发言本身就是针对某个被指控者的反击
  const isCounterAttack = [...targetNames].some((name) => lastEntry.content.includes(name));
  if (!isCounterAttack) return null;

  // 计算冲突强度
  const baseIntensity = Math.min(
    10 + recentAccusations.length * 15 + recentDefs.length * 8 + contributionOfEntry(state, lastEntry) * 2,
    95,
  );
  // 基于性格加成
  const attacker = state.players.find((p) => p.playerId === lastEntry.playerId);
  const defender = state.players.find((p) => p.character.name && [...targetNames].includes(p.character.name));
  if (!attacker || !defender) return null;

  const attackerAggro = /暴躁|强势|阴郁|豪爽|直率/.test(attacker.character.personality) ? 15 : 0;
  const defenderDef = /敏感|胆小|温柔/.test(defender.character.personality) ? -10 : 0;
  const intensity = Math.min(Math.max(baseIntensity + attackerAggro + defenderDef, 5), 95);

  // 按强度决定动作类型
  let action: ConflictEvent['action'];
  if (intensity >= 75) action = 'fight';
  else if (intensity >= 55) action = 'grab';
  else if (intensity >= 35) action = 'shove';
  else action = Math.random() < 0.5 ? 'shout' : 'threaten';

  // 描述模板
  const descriptions: Record<string, string[]> = {
    shout: [
      `${attacker.nickname}（${attacker.character.name}）猛地一拍桌子怒吼：${defender.nickname}（${defender.character.name}），你有什么资格说话！`,
      `${attacker.character.name}站起身来，指着${defender.character.name}大声斥责：别以为我不知道你在隐瞒什么！`,
      `${attacker.nickname}的嗓音骤然拔高：你根本就是在替${state.victim}打掩护！`,
    ],
    threaten: [
      `${attacker.character.name}逼近${defender.character.name}：如果你敢继续乱说，我不会放过你。`,
      `${attacker.nickname}压低声音对${defender.nickname}放狠话：再追查下去，你会后悔的。`,
    ],
    shove: [
      `${attacker.nickname}一把推了${defender.nickname}（${defender.character.name}）肩膀一把：别再胡说八道！`,
      `${attacker.character.name}伸手阻拦${defender.character.name}：你给我站住！`,
    ],
    grab: [
      `${attacker.nickname}一把揪住${defender.nickname}（${defender.character.name}）的衣领：把话说清楚！`,
      `${attacker.character.name}攥住${defender.character.name}的手腕，用力捏紧：你藏了什么？`,
    ],
    fight: [
      `${attacker.nickname}与${defender.nickname}（${defender.character.name}）扭打在一起，两人撞翻了椅子！`,
      `${attacker.character.name}和${defender.character.name}互相揪着对方的衣领，场面一度失控……`,
      `${attacker.nickname}一拳挥向${defender.nickname}，被旁人及时拉开——两人之间的敌意已经彻底爆发！`,
    ],
  };

  const descList = descriptions[action]!;
  const description = descList[Math.floor(Math.random() * descList.length)];

  const conflict: ConflictEvent = {
    id: crypto.randomUUID(),
    round: state.round,
    phase: state.phase,
    participants: [
      { playerId: attacker.playerId, nickname: attacker.nickname, characterName: attacker.character.name },
      { playerId: defender.playerId, nickname: defender.nickname, characterName: defender.character.name },
    ],
    intensity,
    action,
    description,
    trigger: recentAccusations[recentAccusations.length - 1]!.content.slice(0, 60),
    timestamp: Date.now(),
  };

  return conflict;
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

  // 平票或无人投票 → 僵局计数；连续 3 次则按累计嫌疑度强制指认
  let forcedAccused: string | null = null;
  if (tie || !accused || maxVotes === 0) {
    next.consecutiveTies = (next.consecutiveTies ?? 0) + 1;
    if (next.consecutiveTies >= 3) {
      // 连续平票僵局兜底（与谁是卧底一致）：按累计嫌疑度强制指认一人，
      // 走下方正常结算（指认正确→好人胜；错误→淘汰+下一轮），
      // 防止 AI 票型长期对称导致调查无限拖延
      forcedAccused = resolveMysteryTiebreak(next);
    }
    if (!forcedAccused) {
      rememberPublicNote(next, tie ? '本轮出现平票，说明大家对凶手判断仍未统一。' : '本轮无人投票，场上仍缺一个足够让大家信服的怀疑对象。');
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
  }

  // 有人被投出（含连续平票后的强制指认）
  next.consecutiveTies = 0;
  const finalAccused = forcedAccused ?? accused;
  if (!finalAccused) return nextMysteryRound(next); // 理论不可达（非平票时 accused 必非空），防御性兜底
  next.accusedMurdererId = finalAccused;
  const accusedPlayer = next.players.find((p) => p.playerId === finalAccused);
  const isCorrect = finalAccused === next.murdererId;

  if (isCorrect) {
    // 证据链评估：已发现的关键线索环数决定结局档次（侦探思维的可视化回报）
    const chainSteps = new Set(
      next.clues
        .filter((c) => c.isKey && c.chainStep && next.discoveredClues.includes(c.id))
        .map((c) => c.chainStep),
    );
    const chainVerdict =
      chainSteps.size >= 3
        ? `证据链（${chainSteps.size} 个环节）完整闭合——这不是运气，是真正的推理。`
        : chainSteps.size >= 2
          ? `证据链只差最后一环（${chainSteps.size}/4），能指认成功多少带一点赌的成分。`
          : '几乎是在证据不足的情况下赌对了人——运气占了上风。';
    rememberPublicNote(next, `${accusedPlayer?.character.name ?? accusedPlayer?.nickname ?? '目标'} 被成功指认为凶手，案件真相即将揭晓。${chainVerdict}`);
    // 投出真凶 → 好人胜利
    next.events.push({
      id: crypto.randomUUID(),
      round: next.round,
      phase: 'voting',
      type: 'vote_result',
      actorName: accusedPlayer?.nickname,
      characterName: accusedPlayer?.character.name,
      content: `${accusedPlayer?.nickname}（${accusedPlayer?.character.name}）被指控为凶手！指控正确！${chainVerdict}${next.accompliceId && next.players.find((p) => p.playerId === next.accompliceId)?.isAlive ? '顺带一提：帮凶仍混在你们中间，等待复盘揭晓。' : ''}真相大白。`,
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

    // 帮凶被投出：身份反转大事件——被指认者不是凶手，竟是凶手的帮凶！真凶仍逍遥法外
    if (accusedPlayer.character.isAccomplice) {
      const twist: PlotTwist = {
        id: crypto.randomUUID(),
        round: next.round,
        kind: 'identity',
        title: '帮凶身份暴露',
        content: `被投出的${accusedPlayer.character.name}竟然不是凶手——TA是凶手的帮凶！在众人的逼问下，${accusedPlayer.character.name}崩溃地喊道："我只是在替TA打掩护……但我说什么都不会出卖TA！"真凶仍然逍遥法外，而这桩案子的水，比你们想象的深得多。`,
        timestamp: Date.now(),
      };
      next.twists.push(twist);
      rememberPublicNote(next, `${accusedPlayer.character.name} 被揭穿为帮凶！真凶另有其人，且与帮凶的关系成为新的破案方向。`);
      next.events.push({
        id: crypto.randomUUID(),
        round: next.round,
        phase: 'voting',
        type: 'twist',
        actorName: accusedPlayer.nickname,
        characterName: accusedPlayer.character.name,
        content: `【剧情反转·帮凶身份暴露】${twist.content}`,
        timestamp: Date.now(),
      });
    } else {
      rememberPublicNote(next, `${accusedPlayer.character.name} 被投出但并非凶手，场上判断方向需要彻底重估。`);
    }
  }

  // 被伪证误导的出局：凶手伪造的线索把大家引向了无辜者
  const framedClue = accusedPlayer
    ? next.clues.find((c) => c.isFabricated && c.fabricatedTo === accusedPlayer.character.name && !c.isFabricationExposed)
    : undefined;
  if (framedClue) {
    framedClue.isFabricationExposed = true;
    next.events.push({
      id: crypto.randomUUID(),
      round: next.round,
      phase: 'voting',
      type: 'twist',
      content: `【剧情反转·伪证反噬】复盘发现：让${accusedPlayer?.character.name}背上嫌疑的线索【${framedClue.name}】竟是凶手伪造的伪证！真凶用你们的推理习惯反过来利用了你们——这恰恰说明TA对每个人的心理了如指掌。`,
      timestamp: Date.now(),
    });
  }

  next.events.push({
    id: crypto.randomUUID(),
    round: next.round,
    phase: 'voting',
    type: 'vote_result',
    actorName: accusedPlayer?.nickname,
    characterName: accusedPlayer?.character.name,
    content: `${accusedPlayer?.nickname}（${accusedPlayer?.character.name}）被投票出局，但TA不是凶手！${accusedPlayer?.character.isAccomplice ? '更令人震惊的是——TA是凶手的帮凶！' : ''}真凶仍藏匿其中，调查继续……`,
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
  const say = (line: string): string => `${mysterySpeechLead(character)}${line}`;

  // ---- 公共辅助：构建上下文 ----
  const discoveredClueObjs = state.clues.filter((c) => state.discoveredClues.includes(c.id));
  const keyClues = discoveredClueObjs.filter((c) => c.isKey);
  const recentDiscussions = state.discussionLog.filter((d) => d.playerId !== player.playerId).slice(-4);
  const rankedSuspects = rankMysterySuspectsForPlayer(state, player);
  const topSuspect = rankedSuspects[0];
  const cluePointingTopSuspect = topSuspect
    ? keyClues.find((clue) => clueImplicationScore(clue, topSuspect) > 0) ?? discoveredClueObjs.find((clue) => clueImplicationScore(clue, topSuspect) > 0)
    : undefined;
  const recentMentionsMe = recentDiscussions.filter(
    (entry) => entry.content.includes(character.name) || entry.content.includes(player.nickname),
  );

  // ---- 自我介绍阶段 ----
  if (type === 'introduction') {
    if (isMurderer) {
      const openerTemplates = [
        `我是${character.name}，${character.role}。${character.backstory.slice(0, 35)}……关于${victim}的事，我深感遗憾，会全力配合调查。`,
        `诸位好，我是${character.name}。${character.backstory.slice(0, 30)}……愿${victim}的在天之灵能早日安息。`,
        `我是${character.name}，${character.role}。${character.backstory.slice(0, 30)}……我也想知道，到底是谁对${victim}下了毒手。`,
      ];
      return say(pick(openerTemplates)!);
    }
    const openerTemplates = [
      `我是${character.name}，${character.role}。${character.backstory.slice(0, 35)}……我会尽力协助查明${victim}被害的真相。`,
      `各位好，我是${character.name}，${character.relationshipToVictim}对于${victim}的离世，我非常悲痛。`,
      `我是${character.name}，${character.role}。${character.backstory.slice(0, 30)}……我一定要找出杀害${victim}的凶手。`,
    ];
    return say(pick(openerTemplates)!);
  }

  // ---- 调查/讨论阶段 ----
  if (type === 'investigation' || type === 'discussion') {
    if (isMurderer) {
      if (recentMentionsMe.length > 0) {
        const defenseLines = [
          `刚才有人把话头引到我身上，但我还是那句话，我和${victim}的死没有关系。与其空口怀疑我，不如把${weapon}和现场线索对应起来。`,
          `你们怀疑我可以，但请先解释清楚证据链。现在只靠气氛带票，只会让真正的凶手继续藏在暗处。`,
        ];
        return say(pick(defenseLines)!);
      }
      // 凶手策略：保持冷静、引导怀疑方向、尽量不谈凶器
      if (topSuspect && topSuspect.playerId !== player.playerId) {
        const frameLines = [
          `我注意到 ${topSuspect.character.name} 刚才的反应有些不对劲，关于${victim}的事，${topSuspect.character.name}是不是知道些什么？`,
          `大家有没有觉得 ${topSuspect.character.name} 一直在回避问题？${topSuspect.character.name} 的不在场证明"${topSuspect.character.alibi}"真的可靠吗？`,
          `我觉得 ${topSuspect.character.name} 的嫌疑很大，${victim}出事前，${topSuspect.character.name}是不是和${victim}有过接触？`,
        ];
        return say(pick(frameLines)!);
      }
      if (recentDiscussions.length > 0) {
        const last = recentDiscussions[recentDiscussions.length - 1]!;
        return say(`我同意 ${last.characterName} 的看法，关于${victim}的案子，我们需要更多${weapon}以外的证据，不能光靠猜测。`);
      }
      const evadeTemplates = [
        `我认为现在下结论太早了，${victim}的案子没那么简单，大家不要被表面现象迷惑。`,
        `这件事没那么简单，希望大家不要被别人带节奏，${victim}的死一定另有隐情。`,
        `根据我的经验，真正的凶手往往最擅长伪装，大家不要轻易怀疑一个看起来无辜的人。`,
      ];
      return say(pick(evadeTemplates)!);
    }

    // 帮凶：表面认真推理，实则把怀疑引向无辜者、为真凶解围
    if (character.isAccomplice) {
      const murderer = state.players.find((p) => p.playerId === state.murdererId && p.isAlive);
      const murdererUnderFire =
        murderer && recentDiscussions.some(
          (entry) => entry.content.includes(murderer.character.name) || entry.content.includes(murderer.nickname),
        );
      // 真凶被点名 → 立即用"合理怀疑"为TA解围，把矛头转向别人
      if (murdererUnderFire && topSuspect && topSuspect.playerId !== state.murdererId) {
        const coverLines = [
          `等等，仅凭这些就怀疑${murderer!.character.name}？我认为太草率了。相反，${topSuspect.character.name}的"${topSuspect.character.alibi}"才最经不起推敲——案发时间点上根本对不齐。`,
          `恕我直言，把精力浪费在${murderer!.character.name}身上是中了真凶的圈套。${topSuspect.character.name}与${victim}的关系才是最值得深挖的。`,
        ];
        return say(pick(coverLines)!);
      }
      // 带节奏：主动放大高嫌疑无辜者的嫌疑（尤其顺着未揭穿的伪证指向说）
      const unexposedFabricated = discoveredClueObjs.find(
        (c) => c.isFabricated && !c.isFabricationExposed,
      );
      if (unexposedFabricated && Math.random() < 0.6) {
        return say(`线索【${unexposedFabricated.name}】的信息量比你们意识到的大得多——${unexposedFabricated.revealsInfo.slice(0, 45)}……这几乎就是明示了吧？我建议重点查一查这个人。`);
      }
      if (topSuspect && topSuspect.playerId !== player.playerId && topSuspect.playerId !== state.murdererId) {
        return say(`我一直在默默核对每个人的说法，越核对越觉得 ${topSuspect.character.name} 的解释漏洞最多。"${topSuspect.character.alibi}"听起来完整，但缺少一个能独立作证的人。`);
      }
      return say(`直觉告诉我，最不可能是凶手的人反而最可疑。${victim}这案子，大家都别太相信自己的第一印象。`);
    }

    // 非凶手：结合线索和讨论推理
    if (recentMentionsMe.length > 0 && Math.random() < 0.5) {
      const defenseTemplates = [
        `既然有人提到我，我就把话说清楚：我的不在场证明是"${character.alibi}"。如果有人觉得我可疑，请直接拿出能对上的线索。`,
        `我可以接受质疑，但不能接受空口断案。我的动机和行动线都摆在这里，真正该解释的是那些一直回避关键线索的人。`,
      ];
        return say(pick(defenseTemplates)!);
    }
    if (discoveredClueObjs.length > 0 && Math.random() < 0.6) {
      const clue = pick(keyClues) ?? discoveredClueObjs[discoveredClueObjs.length - 1]!;
      if (clue && topSuspect) {
        return say(`我们发现的${clue.isKey ? '关键' : ''}线索【${clue.name}】：${clue.revealsInfo.slice(0, 50)}……这条线索和 ${topSuspect.character.name} 的说法对不上，我想听听 ${topSuspect.character.name} 怎么解释。`);
      }
      if (clue) {
        return say(`线索【${clue.name}】揭示了：${clue.revealsInfo}，请大家仔细分析这条线索与${victim}之死的关系。`);
      }
    }
    if (topSuspect && Math.random() < 0.5) {
      return say(`从目前的线索来看，${topSuspect.character.name} 的嫌疑最大。${topSuspect.character.name} 与${victim}的关系是"${topSuspect.character.relationshipToVictim}"，而且"${topSuspect.character.alibi}"这个不在场证明也不够扎实。`);
    }
    if (recentDiscussions.length > 0 && Math.random() < 0.4) {
      const last = recentDiscussions[recentDiscussions.length - 1]!;
      return say(`我注意到 ${last.characterName} 刚才提到"${last.content.slice(0, 35)}…"，这句话和现在线索能不能对上，我觉得值得继续追问。`);
    }
    // 引用自己的秘密（暗示性）
    if (Math.random() < 0.3) {
      return say(`${character.secret.slice(0, 45)}……我觉得这可能与${victim}的案子有关。`);
    }
    const generalTemplates = [
      `根据${character.personality}的观察，我觉得${victim}的案子还有隐藏的细节，尤其是关于${weapon}的来源。`,
      `我们应该逐一排查每个人与${victim}的关系，"${character.relationshipToVictim}"，每个人都有动机的可能。`,
      `真相往往隐藏在细节中，关于${victim}的死，我注意到一些之前被忽略的地方。`,
      `${victim}出事前，有没有人注意到什么异常？我觉得${weapon}这个凶器值得深究。`,
    ];
    return say(pick(generalTemplates)!);
  }

  // ---- 指控阶段 ----
  if (type === 'accusation') {
    if (isMurderer) {
      // 凶手嫁祸：优先选高嫌疑且非凶手的人
      const candidates = rankedSuspects.filter((p) => !p.character.isMurderer);
      const target = candidates[0] ?? aliveOthers[0];
      if (target) {
        const accuseLines = [
          `我指控${target.character.name}！${target.character.name}与${victim}的关系是"${target.character.relationshipToVictim}"，有充分的作案动机！`,
          `凶手就是${target.character.name}！"${target.character.alibi}"这个不在场证明完全站不住脚，而且${weapon}上一定有${target.character.name}的痕迹！`,
          `我认定${target.character.name}就是杀害${victim}的凶手，请大家把票投给${target.character.name}！`,
        ];
        return say(pick(accuseLines)!);
      }
      return say(`我觉得${aliveOthers[0]?.character.name}非常可疑，${victim}一定是${aliveOthers[0]?.character.name}杀的！`);
    }
    // 帮凶：公开指控一名无辜者，为真凶挡刀（语气更笃定，制造"信息差"）
    if (character.isAccomplice) {
      const candidates = rankedSuspects.filter((p) => !p.character.isMurderer && p.playerId !== player.playerId);
      const target = candidates[0] ?? aliveOthers.find((p) => !p.character.isMurderer);
      if (target) {
        return say(`我反复权衡过所有可能性——我指控${target.character.name}。${target.character.name}的每一条解释都像是提前准备好的，尤其是"${target.character.alibi}"，完美得反而可疑。${victim}的死，答案就在TA身上。`);
      }
      return say(`综合所有线索，我已经有了自己的答案，请大家相信我的判断——真正的凶手，一定不在你们最怀疑的那几个人里。`);
    }
    // 好人：基于线索和嫌疑投票
    if (topSuspect) {
      if (cluePointingTopSuspect) {
        return say(`我现在公开指控${topSuspect.character.name}。线索【${cluePointingTopSuspect.name}】已经把嫌疑锁到了 ${topSuspect.character.name} 身上，再结合TA前后的说法，我认为凶手就是TA。`);
      }
      if (keyClues.length > 0) {
        return say(`根据关键线索【${keyClues[0]!.name}】和目前的发言矛盾，我指控${topSuspect.character.name}是杀害${victim}的凶手！`);
      }
      return say(`根据我们收集的所有线索和圆桌讨论，我指控${topSuspect.character.name}是凶手。${topSuspect.character.name} 的动机、反应和不在场证明都经不起推敲。`);
    }
    if (keyClues.length > 0) {
      return say(`关键线索【${keyClues[0]!.name}】指向了重要信息，但我还需要更多时间来确认凶手身份。`);
    }
    return say(`我还在调查中，但${victim}的案子一定有隐情，请大家再给我一点时间。`);
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
  const isEvil = isMurderer || character.isAccomplice || (character.isPolice && character.isCorrupt);
  const alivePlayers = getAlivePlayers(state).filter((p) => p.playerId !== player.playerId);

  if (alivePlayers.length === 0) {
    return { playerId: player.playerId, targetId: player.playerId };
  }

  let target: MysteryPlayerState;

  if (isEvil) {
    // 凶手 / 帮凶 / 黑警：优先嫁祸高嫌疑的非凶手玩家（保护真凶）
    const nonMurderers = alivePlayers.filter((p) => !p.character.isMurderer);
    // 帮凶与黑警不投凶手；凶手不自投
    const safeTargets = nonMurderers.filter((p) => p.playerId !== state.murdererId);
    const sorted = [...(safeTargets.length > 0 ? safeTargets : nonMurderers)].sort((a, b) => {
      const scoreB = mysteryPublicScore(state, b) + mysteryPersonalityBias(state, player, b);
      const scoreA = mysteryPublicScore(state, a) + mysteryPersonalityBias(state, player, a);
      return scoreB - scoreA;
    });
    target = sorted[0] ?? nonMurderers[Math.floor(Math.random() * nonMurderers.length)] ?? alivePlayers[0];
  } else {
    // 好人（含正直警察）：根据线索和嫌疑推理
    const sorted = rankMysterySuspectsForPlayer(state, player);
    target = sorted[0] ?? alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
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
      publicNotes: state.publicNotes,
      typingPlayerId: state.typingPlayerId ?? null,
      voteStatus: state.voteStatus,
      votes: state.phase === 'voting' ? {} : state.votes,
      players: state.players.map((p) => ({
        playerId: p.playerId,
        nickname: p.nickname,
        seatNumber: getSeatNumber(state, p.playerId),
        character: {
          name: p.character.name,
          role: p.character.role,
          gender: p.character.gender,
          personality: p.character.personality,
          age: p.character.age,
          height: p.character.height,
          weight: p.character.weight,
          specialAbility: p.character.specialAbility,
        },
        isAlive: p.isAlive,
        isPolice: p.character.isPolice,
        suspicionLevel: p.suspicionLevel,
        isLatecomer: p.isLatecomer ?? false,
        joinedRound: p.joinedRound,
      })),
      winner: state.winner,
      conflictLevel: state.conflictLevel,
      conflictEvents: state.conflictEvents,
      twists: state.twists,
      // 观众视角：隐藏仅警察可见的观察记录（visibleTo 限定的侦探/警察推理）
      events: state.events.filter((e) => !e.visibleTo),
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
    publicNotes: state.publicNotes,
    typingPlayerId: state.typingPlayerId ?? null,
    voteStatus: state.voteStatus,
    votes: state.phase === 'voting' ? {} : state.votes,
    players: state.players.map((p) => ({
      playerId: p.playerId,
      nickname: p.nickname,
      seatNumber: getSeatNumber(state, p.playerId),
      character: {
        name: p.character.name,
        role: p.character.role,
        gender: p.character.gender,
        personality: p.character.personality,
        age: p.character.age,
        height: p.character.height,
        weight: p.character.weight,
        isMurderer: finished ? p.character.isMurderer : undefined,
        isAccomplice: finished ? p.character.isAccomplice : undefined,
        isPolice: p.character.isPolice,
        isCorrupt: finished ? p.character.isCorrupt : undefined,
        specialAbility: p.character.specialAbility,
      },
      isAlive: p.isAlive,
      isMe: p.playerId === playerId,
      hasSpoken: p.hasSpoken,
      hasSearched: p.hasSearched,
      suspicionLevel: p.suspicionLevel,
      isLatecomer: p.isLatecomer ?? false,
      joinedRound: p.joinedRound,
    })),
    murdererId: finished ? state.murdererId : undefined,
    accompliceId: finished ? state.accompliceId : undefined,
    accusedMurdererId: state.accusedMurdererId,
    winner: state.winner,
    monologue: finished ? state.monologue : undefined,
    conflictLevel: state.conflictLevel,
    conflictEvents: state.conflictEvents,
    twists: state.twists,
    timelineDisproved: state.timelineDisproved ?? false,
    // 警察观察记录仅警察本人与终局可见，其余玩家过滤掉（防泄露警察身份与推理）
    events: finished
      ? state.events
      : state.events.filter((e) => !e.visibleTo || e.visibleTo.includes(playerId ?? '')),
  };
}
