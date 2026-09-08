import type {
  UndercoverGameState,
  UndercoverPlayerState,
  UndercoverGameEvent,
} from './who-is-undercover-types';
import { WORD_PAIRS } from './who-is-undercover-types';
import { GameError } from './errors';

/** 根据人数决定卧底数量 */
export function undercoverCount(playerCount: number): number {
  if (playerCount <= 5) return 1;
  if (playerCount <= 8) return 2;
  return 3;
}

function shuffle<T>(list: T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function logEvent(
  state: UndercoverGameState,
  type: UndercoverGameEvent['type'],
  content: string,
  actorName?: string,
  targetName?: string,
): void {
  state.events.push({
    id: crypto.randomUUID(),
    round: state.round,
    phase: state.phase,
    type,
    actorName,
    targetName,
    content,
    timestamp: Date.now(),
  });
}

function findPlayer(state: UndercoverGameState, playerId: string): UndercoverPlayerState {
  const player = state.players.find((p) => p.playerId === playerId);
  if (!player) throw new GameError('player_not_found', '玩家不存在');
  return player;
}

export function getAlivePlayers(state: UndercoverGameState): UndercoverPlayerState[] {
  return state.players.filter((p) => p.isAlive);
}

/** 初始化游戏状态 */
export function initUndercoverState(
  players: { playerId: string; nickname: string }[],
): UndercoverGameState {
  if (players.length < 4) throw new GameError('not_enough_players', '谁是卧底至少需要 4 名玩家');

  const pair = WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];
  const flipped = Math.random() < 0.5;
  const civilianWord = flipped ? pair[1] : pair[0];
  const undercoverWord = flipped ? pair[0] : pair[1];

  const ids = shuffle(players.map((p) => p.playerId));
  const undercoverIds = new Set(ids.slice(0, undercoverCount(players.length)));

  return {
    format: 2,
    phase: 'describing',
    round: 1,
    players: players.map((p) => ({
      playerId: p.playerId,
      nickname: p.nickname,
      role: undercoverIds.has(p.playerId) ? 'undercover' : 'civilian',
      word: undercoverIds.has(p.playerId) ? undercoverWord : civilianWord,
      isAlive: true,
      hasDescribed: false,
      suspicion: 0,
    })),
    civilianWord,
    undercoverWord,
    descriptions: [],
    order: shuffle(players.map((p) => p.playerId)),
    orderCursor: 0,
    votes: {},
    voteStatus: {},
    consecutiveTies: 0,
    events: [
      {
        id: crypto.randomUUID(),
        round: 1,
        phase: 'describing',
        type: 'game_start',
        content: `游戏开始！平民拿到相同的词，卧底拿到了相似的词。每人轮流用一句话描述自己的词（不能直接说出这个词），然后投票找出卧底。共 ${players.length} 名玩家。`,
        timestamp: Date.now(),
      },
    ],
  };
}

/** 当前轮到谁描述 */
export function currentSpeaker(state: UndercoverGameState): UndercoverPlayerState | null {
  while (state.orderCursor < state.order.length) {
    const player = findPlayer(state, state.order[state.orderCursor]);
    if (player.isAlive && !player.hasDescribed) return player;
    state.orderCursor += 1;
  }
  return null;
}

/** 描述自己的词 */
export function applyDescription(state: UndercoverGameState, playerId: string, content: string): void {
  const speaker = currentSpeaker(state);
  if (!speaker) throw new GameError('not_describing', '当前不是描述阶段');
  if (speaker.playerId !== playerId) throw new GameError('not_your_turn', '还没轮到你描述');

  const text = content.trim().slice(0, 120);
  if (!text) throw new GameError('empty_speech', '描述不能为空');
  if (text.includes(speaker.word)) throw new GameError('word_leaked', '不能直接说出你的词');

  speaker.hasDescribed = true;
  state.descriptions.push({
    playerId,
    nickname: speaker.nickname,
    round: state.round,
    content: text,
  });
  logEvent(state, 'player_action', `${speaker.nickname}：${text}`, speaker.nickname);
  state.orderCursor += 1;
}

/** 跳过描述（沉默也是一种态度） */
export function applyDescriptionSkip(state: UndercoverGameState, playerId: string): void {
  const speaker = currentSpeaker(state);
  if (!speaker) throw new GameError('not_describing', '当前不是描述阶段');
  if (speaker.playerId !== playerId) throw new GameError('not_your_turn', '还没轮到你描述');

  speaker.hasDescribed = true;
  logEvent(state, 'player_action', `${speaker.nickname} 沉默了一会，没有描述`, speaker.nickname);
  state.orderCursor += 1;
}

/** 所有人描述完 → 进入投票 */
export function startVoting(state: UndercoverGameState): void {
  if (state.phase !== 'describing') throw new GameError('not_describing', '当前不是描述阶段');
  if (currentSpeaker(state)) throw new GameError('still_describing', '还有人没描述');
  state.phase = 'voting';
  state.votes = {};
  state.voteStatus = {};
  logEvent(state, 'phase_change', `第 ${state.round} 轮描述结束，进入投票`);
}

/** 投票（targetId 为 null 表示弃票） */
export function applyUndercoverVote(state: UndercoverGameState, playerId: string, targetId: string | null): void {
  if (state.phase !== 'voting') throw new GameError('not_voting', '当前不是投票阶段');
  const voter = findPlayer(state, playerId);
  if (!voter.isAlive) throw new GameError('player_dead', '你已出局');
  if (state.voteStatus[playerId]) throw new GameError('already_voted', '本轮已投票');

  if (targetId === null) {
    state.voteStatus[playerId] = 'abstained';
    logEvent(state, 'player_action', `${voter.nickname} 弃票`, voter.nickname);
    return;
  }
  const target = findPlayer(state, targetId);
  if (!target.isAlive) throw new GameError('target_dead', '目标已出局');
  if (targetId === playerId) throw new GameError('cannot_vote_self', '不能投票给自己');

  state.voteStatus[playerId] = 'voted';
  state.votes[playerId] = targetId;
}

/** 检查胜负：卧底清零 → 平民胜；只剩 1 平民 + 1 卧底 → 卧底胜 */
export function checkUndercoverVictory(state: UndercoverGameState): 'civilians' | 'undercover' | null {
  const alive = getAlivePlayers(state);
  const aliveUndercover = alive.filter((p) => p.role === 'undercover').length;
  const aliveCivilian = alive.length - aliveUndercover;
  if (aliveUndercover === 0) return 'civilians';
  if (aliveCivilian <= 1 && aliveUndercover >= 1) return 'undercover';
  return null;
}

/** 结算投票 → 淘汰 → 胜负/下一轮 */
export function resolveUndercoverVote(state: UndercoverGameState): void {
  if (state.phase !== 'voting') throw new GameError('not_voting', '当前不是投票阶段');

  const tally: Record<string, number> = {};
  for (const targetId of Object.values(state.votes)) {
    tally[targetId] = (tally[targetId] ?? 0) + 1;
  }
  for (const [targetId, count] of Object.entries(tally)) {
    const p = state.players.find((x) => x.playerId === targetId);
    if (p) p.suspicion += count;
  }

  const voteSummary = Object.entries(state.votes)
    .map(([voterId, targetId]) => {
      const voter = state.players.find((p) => p.playerId === voterId);
      const target = state.players.find((p) => p.playerId === targetId);
      return `${voter?.nickname}→${target?.nickname}`;
    })
    .join('，');
  if (voteSummary) logEvent(state, 'player_action', `投票详情：${voteSummary}`);

  let eliminated: string | null = null;
  let maxVotes = 0;
  let tie = false;
  for (const [playerId, count] of Object.entries(tally)) {
    if (count > maxVotes) {
      maxVotes = count;
      eliminated = playerId;
      tie = false;
    } else if (count === maxVotes && playerId !== eliminated) {
      tie = true;
    }
  }

  if (tie || !eliminated || maxVotes === 0) {
    state.consecutiveTies += 1;
    logEvent(state, 'vote_result', `平票，本轮无人出局（连续僵局第 ${state.consecutiveTies} 轮）`);
    if (state.consecutiveTies >= 3) {
      resolveTiebreak(state);
      return;
    }
  } else {
    state.consecutiveTies = 0;
    const target = findPlayer(state, eliminated);
    target.isAlive = false;
    target.eliminatedRound = state.round;
    state.eliminatedThisRound = { playerId: eliminated, role: target.role };
    logEvent(
      state,
      'player_eliminated',
      `${target.nickname} 以 ${maxVotes} 票被淘汰，身份是——${target.role === 'undercover' ? '卧底！' : '平民。'}`,
      undefined,
      target.nickname,
    );
  }

  const winner = checkUndercoverVictory(state);
  if (winner) {
    state.winner = winner;
    state.phase = 'result';
    logEvent(
      state,
      'game_end',
      winner === 'civilians'
        ? `平民胜利！所有卧底都被找出来了。平民词是「${state.civilianWord}」，卧底词是「${state.undercoverWord}」。`
        : `卧底胜利！平民词是「${state.civilianWord}」，卧底词是「${state.undercoverWord}」。`,
    );
    return;
  }

  nextRound(state);
}

/** 进入下一轮描述（发言顺序轮转起点） */
export function nextRound(state: UndercoverGameState): void {
  state.phase = 'describing';
  state.round += 1;
  state.descriptions = [];
  state.votes = {};
  state.voteStatus = {};
  state.eliminatedThisRound = undefined;
  for (const p of state.players) p.hasDescribed = false;
  // 轮转：以上一轮第一位发言者的下一位开始
  const first = state.order[0];
  const rest = state.order.slice(1);
  state.order = [...rest, first];
  state.orderCursor = 0;
  logEvent(state, 'phase_change', `第 ${state.round} 轮描述开始，从 ${findPlayer(state, state.order[0]).nickname} 开始`);
}

/** 连续 3 轮平票僵局：按嫌疑值最高者淘汰，强制打破僵局 */
export function resolveTiebreak(state: UndercoverGameState): void {
  state.consecutiveTies = 0;
  const alive = getAlivePlayers(state);
  const sorted = [...alive].sort((a, b) => b.suspicion - a.suspicion || (a.nickname > b.nickname ? 1 : -1));
  const target = sorted[0]!;
  target.isAlive = false;
  target.eliminatedRound = state.round;
  state.eliminatedThisRound = { playerId: target.playerId, role: target.role };
  logEvent(
    state,
    'player_eliminated',
    `连续 ${state.round} 轮平票僵局，${target.nickname} 因嫌疑最高被强制淘汰，身份是——${target.role === 'undercover' ? '卧底！' : '平民。'}`,
    undefined,
    target.nickname,
  );
}

// ===== AI 行为 =====

/** 由词生成稳定提示（同词的人描述会相似，卧底词不同会产生偏差） */
function wordHints(word: string): { place: string; feeling: string; color: string; category: string } {
  const places = ['超市', '家里', '街上', '学校', '办公室', '厨房', '商场'];
  const feelings = ['熟悉', '亲切', '放松', '日常', '温暖', '特别'];
  const colors = ['红色', '白色', '蓝色', '透明', '彩色', '暖色'];
  const categories = ['食物', '饮品', '日用品', '动物', '植物', '场所', '人物', '物品'];
  let hash = 0;
  for (const ch of word) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return {
    place: places[hash % places.length],
    feeling: feelings[(hash >> 2) % feelings.length],
    color: colors[(hash >> 4) % colors.length],
    category: categories[(hash >> 6) % categories.length],
  };
}

/** 计算两个描述文本的相似度（基于关键词重叠） */
function descriptionSimilarity(a: string, b: string): number {
  const charsA = new Set(a.replace(/[，。！？、的了我是在和它有给感觉如果说到它通常和某个特定场景联系一起身边不少朋友都喜欢生活里很常见东西脑海里有一幅具体画面经常能见到]/g, '').split(''));
  const charsB = new Set(b.replace(/[，。！？、的了我是在和它有给感觉如果说到它通常和某个特定场景联系一起身边不少朋友都喜欢生活里很常见东西脑海里有一幅具体画面经常能见到]/g, '').split(''));
  const common = [...charsA].filter((c) => charsB.has(c)).length;
  const union = new Set([...charsA, ...charsB]).size;
  return union === 0 ? 0 : common / union;
}

/** AI 描述自己的词（不直接说出词） */
export function generateUndercoverDescription(state: UndercoverGameState, player: UndercoverPlayerState): string {
  const hints = wordHints(player.word);
  const round = state.round;
  const isUndercover = player.role === 'undercover';
  const prevDescriptions = state.descriptions.filter((d) => d.round === round);

  // 第一轮：基础描述
  if (round === 1) {
    const templates = [
      `我想到的东西在${hints.place}经常能见到。`,
      `它给我的感觉是${hints.feeling}的。`,
      `如果要给它一个颜色，我觉得是${hints.color}。`,
      `它是一种${hints.category}，大家应该都接触过。`,
      `说到它，我脑海里有一幅具体的画面。`,
    ];
    // 卧底在第一轮更谨慎，选模糊的描述
    if (isUndercover && Math.random() < 0.4) {
      return `这个东西嘛...我觉得大家都应该知道，不太好具体形容。`;
    }
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // 后续轮次：参考前文，增加深度
  if (prevDescriptions.length > 0) {
    if (isUndercover) {
      // 卧底：尝试模仿多数人的描述方向，但制造细微偏差
      const mimicTemplates = [
        `我同意刚才说的，不过我觉得还有另一层意思。`,
        `和前面说的差不多，但我想到的角度略有不同。`,
        `嗯，大家说的都有道理，我的想法也类似。`,
        `我补充一点，它确实和${hints.category}有关，但不止于此。`,
      ];
      return mimicTemplates[Math.floor(Math.random() * mimicTemplates.length)];
    }

    // 平民：基于自己的词深入描述，与同阵营产生共鸣
    const deepTemplates = [
      `刚才有人提到了，确实如此。我的词更偏向${hints.category}类。`,
      `我同意前面说的。如果要具体一点，它和${hints.place}关系密切。`,
      `前面描述的方向我认同，${hints.feeling}是我对它的直观感受。`,
      `综合大家的说法，我的词应该不难猜，是${hints.category}的一种。`,
    ];
    return deepTemplates[Math.floor(Math.random() * deepTemplates.length)];
  }

  // 兜底
  const fallback = [
    `它是我生活里很常见的东西。`,
    `说到它，我脑海里有一幅具体的画面。`,
    `它通常和某个特定的场景联系在一起。`,
  ];
  return fallback[Math.floor(Math.random() * fallback.length)];
}

/** 分析描述偏离度：找出与其他人描述差异最大的玩家 */
function analyzeDescriptionOutliers(state: UndercoverGameState): Map<string, number> {
  const roundDescriptions = state.descriptions.filter((d) => d.round === state.round);
  if (roundDescriptions.length < 2) return new Map();

  const outlierScores = new Map<string, number>();
  for (const desc of roundDescriptions) {
    let totalSim = 0;
    let count = 0;
    for (const other of roundDescriptions) {
      if (desc.playerId === other.playerId) continue;
      totalSim += descriptionSimilarity(desc.content, other.content);
      count += 1;
    }
    const avgSim = count > 0 ? totalSim / count : 0;
    // 相似度越低 = 偏离度越高 = 嫌疑越高
    outlierScores.set(desc.playerId, 1 - avgSim);
  }
  return outlierScores;
}

/** AI 投票：卧底投平民，平民按嫌疑+描述偏离度投票 */
export function decideUndercoverVote(
  state: UndercoverGameState,
  player: UndercoverPlayerState,
): { targetId: string | null } {
  const alive = getAlivePlayers(state).filter((p) => p.playerId !== player.playerId);
  if (alive.length === 0) return { targetId: null };

  if (player.role === 'undercover') {
    const civilians = alive.filter((p) => p.role === 'civilian');
    if (civilians.length === 0) return { targetId: null };
    // 卧底策略：投嫌疑最低的平民（避免投嫌疑高的引起注意）
    // 但如果到了后期（剩余人数少），改为投嫌疑最高的平民加速获胜
    const aliveCount = alive.length;
    if (aliveCount <= 3) {
      const sorted = [...civilians].sort((a, b) => b.suspicion - a.suspicion);
      return { targetId: sorted[0].playerId };
    }
    const sorted = [...civilians].sort((a, b) => a.suspicion - b.suspicion);
    return { targetId: sorted[0].playerId };
  }

  // 平民：综合嫌疑值和描述偏离度投票
  const outliers = analyzeDescriptionOutliers(state);
  const scored = alive.map((p) => ({
    player: p,
    score: p.suspicion + (outliers.get(p.playerId) ?? 0) * 3,
  }));
  scored.sort((a, b) => b.score - a.score);

  if (scored[0] && scored[0].score > 0) return { targetId: scored[0].player.playerId };
  if (Math.random() < 0.1) return { targetId: null };
  return { targetId: scored[0].player.playerId };
}

/** 玩家视角 */
export function getUndercoverView(state: UndercoverGameState, playerId: string | null) {
  const me = playerId ? state.players.find((p) => p.playerId === playerId) : undefined;
  const finished = state.phase === 'result';

  return {
    format: state.format,
    phase: state.phase,
    round: state.round,
    game: 'who_is_undercover',
    players: state.players.map((p) => ({
      playerId: p.playerId,
      nickname: p.nickname,
      isAlive: p.isAlive,
      role: finished ? p.role : undefined,
      word: finished ? p.word : undefined,
      isMe: p.playerId === playerId,
      hasDescribed: p.hasDescribed,
    })),
    myWord: me?.word,
    myRole: me?.role,
    descriptions: state.descriptions,
    order: state.order,
    orderCursor: state.orderCursor,
    currentSpeakerId: currentSpeaker(state)?.playerId ?? null,
    voteStatus: state.voteStatus,
    votes: state.phase === 'voting' ? {} : state.votes,
    eliminatedThisRound: state.eliminatedThisRound,
    winner: state.winner,
    civilianWord: finished ? state.civilianWord : undefined,
    undercoverWord: finished ? state.undercoverWord : undefined,
    events: state.events,
  };
}
