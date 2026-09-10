import type {
  UndercoverGameState,
  UndercoverPlayerState,
  UndercoverGameEvent,
  UndercoverPersona,
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

function pick<T>(list: T[]): T | undefined {
  return list.length > 0 ? list[Math.floor(Math.random() * list.length)] : undefined;
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

function getSeatNumber(state: UndercoverGameState, playerId: string): number | null {
  const index = state.players.findIndex((player) => player.playerId === playerId);
  return index >= 0 ? index + 1 : null;
}

const UNDERCOVER_PERSONAS: UndercoverPersona[] = ['谨慎试探型', '联想发散型', '稳健跟随型', '大胆误导型'];

function assignUndercoverPersona(role: 'civilian' | 'undercover'): UndercoverPersona {
  if (role === 'undercover') return Math.random() < 0.5 ? '大胆误导型' : '稳健跟随型';
  return pick(UNDERCOVER_PERSONAS.filter((persona) => persona !== '大胆误导型')) ?? '谨慎试探型';
}

function rememberPublicNote(state: UndercoverGameState, content: string): void {
  const trimmed = content.trim();
  if (!trimmed) return;
  const last = state.publicNotes[state.publicNotes.length - 1];
  if (last?.content === trimmed && last.round === state.round) return;
  state.publicNotes.push({ round: state.round, content: trimmed });
}

function personaLead(player: UndercoverPlayerState): string {
  switch (player.persona) {
    case '谨慎试探型':
      return '我先说得保守一点，';
    case '联想发散型':
      return '我脑子里的画面感比较强，';
    case '稳健跟随型':
      return '我先顺着大家能理解的方向说，';
    case '大胆误导型':
      return '我换个不那么直白的角度讲，';
    default:
      return '';
  }
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
      persona: assignUndercoverPersona(undercoverIds.has(p.playerId) ? 'undercover' : 'civilian'),
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
    publicNotes: [{ round: 1, content: '开局提醒：先给模糊但可共鸣的描述，别急着把词说得太死。' }],
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
  const roundDescriptions = state.descriptions.filter((description) => description.round === state.round);
  const outliers = analyzeDescriptionOutliers(state);
  const topOutlier = [...outliers.entries()].sort((a, b) => b[1] - a[1])[0];
  const focusPlayer = topOutlier ? state.players.find((player) => player.playerId === topOutlier[0]) : undefined;
  rememberPublicNote(
    state,
    roundDescriptions.length > 0
      ? `第 ${state.round} 轮描述已结束。${focusPlayer ? `目前最像“没跟上大多数人节奏”的是 ${focusPlayer.nickname}。` : '目前还没有绝对的离群对象。'}`
      : `第 ${state.round} 轮描述已结束，准备进入投票。`,
  );
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
    rememberPublicNote(state, `第 ${state.round} 轮出现平票僵局，说明大家对“谁更像异类”仍未形成共识。`);
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
    rememberPublicNote(state, `${target.nickname} 在第 ${state.round} 轮被集中投出，场上会据此重新调整怀疑方向。`);
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
  rememberPublicNote(state, `第 ${state.round} 轮开始，所有人需要换个角度描述，别直接重复上一轮的话。`);
  logEvent(state, 'phase_change', `第 ${state.round} 轮描述开始，从 ${findPlayer(state, state.order[0]).nickname} 开始。本轮请尽量换个角度描述，不要重复上一轮原话。`);
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

function extractHintTags(text: string): string[] {
  const cleaned = text.replace(/[，。！？、；：“”"'（）()…\s]/g, '');
  const tags = new Set<string>();
  for (let i = 0; i < cleaned.length; i++) {
    const single = cleaned[i];
    if (single) tags.add(single);
    if (i < cleaned.length - 1) tags.add(cleaned.slice(i, i + 2));
  }
  return [...tags].filter((tag) => tag.length > 0);
}

/** 计算两个描述文本的相似度（基于关键词重叠） */
function descriptionSimilarity(a: string, b: string): number {
  const tagsA = new Set(extractHintTags(a));
  const tagsB = new Set(extractHintTags(b));
  const common = [...tagsA].filter((tag) => tagsB.has(tag)).length;
  const union = new Set([...tagsA, ...tagsB]).size;
  return union === 0 ? 0 : common / union;
}

/** AI 描述自己的词（不直接说出词） */
export function generateUndercoverDescription(state: UndercoverGameState, player: UndercoverPlayerState): string {
  const hints = wordHints(player.word);
  const round = state.round;
  const isUndercover = player.role === 'undercover';
  const prevDescriptions = state.descriptions.filter((d) => d.round === round);
  const previousOwnDescriptions = state.descriptions.filter((d) => d.playerId === player.playerId);
  const dominantAngle = prevDescriptions.length > 0 ? prevDescriptions[prevDescriptions.length - 1]?.content : '';

  const angleTemplates = {
    scene: `我会把它和${hints.place}这个场景联系起来。`,
    feeling: `它给人的第一感觉更偏${hints.feeling}。`,
    color: `如果非要用颜色概括，我第一反应是${hints.color}。`,
    category: `它在我脑子里更像一种${hints.category}。`,
    daily: `这个东西离日常生活不远，很多人其实经常接触。`,
    function: `我会更想从“它能拿来干什么”这个角度去描述。`,
    exclusion: `它不是那种特别张扬的东西，但一提到相关场景就会想到它。`,
  } as const;
  const unusedAngles = Object.values(angleTemplates).filter(
    (template) => !previousOwnDescriptions.some((description) => description.content === template),
  );

  // 第一轮：基础描述
  if (round === 1) {
    const templates = [
      angleTemplates.scene,
      angleTemplates.feeling,
      angleTemplates.color,
      angleTemplates.category,
      angleTemplates.daily,
    ];
    // 卧底在第一轮更谨慎，选模糊的描述
    if (isUndercover && Math.random() < 0.4) {
      return `${personaLead(player)}这个词我不想说得太实，但它应该是大家都见过、也不算陌生的东西。`;
    }
    return `${personaLead(player)}${templates[Math.floor(Math.random() * templates.length)]}`;
  }

  // 后续轮次：参考前文，增加深度
  if (prevDescriptions.length > 0) {
    if (isUndercover) {
      // 卧底：尝试模仿多数人的描述方向，但制造细微偏差
      const mimicTemplates = [
        `前面有人提到"${dominantAngle?.slice(0, 10) ?? '那个方向'}"，我大致也能往那个方向理解，但我更想从别的角度补一句。`,
        `和前面的描述不冲突，不过我想到的是另外一个场景，不一定完全一样。`,
        `我理解大家在说什么，我补充一点：它可能确实和${hints.category}有关，但我脑子里先跳出来的是别的画面。`,
        `我不完全反对前面的说法，只是我会把它想得更偏${hints.feeling}一点。`,
      ];
      return `${personaLead(player)}${mimicTemplates[Math.floor(Math.random() * mimicTemplates.length)]}`;
    }

    // 平民：基于自己的词深入描述，与同阵营产生共鸣
    const deepTemplates = [
      unusedAngles[0] ?? `我再换个角度说，它和${hints.place}这个场景关系很密切。`,
      `前面描述的方向我基本认同，但我更想强调它给人的感觉是${hints.feeling}。`,
      `如果上一轮大家都在说外观，那我这一轮想说用途，它通常不会脱离日常场景。`,
      `综合大家的说法，我的词不算离谱，它和${hints.category}这条线是对得上的。`,
    ];
    return `${personaLead(player)}${deepTemplates[Math.floor(Math.random() * deepTemplates.length)]}`;
  }

  // 兜底
  const fallback = [
    `它是我生活里很常见的东西。`,
    `说到它，我脑海里有一幅具体的画面。`,
    `它通常和某个特定的场景联系在一起。`,
  ];
  return `${personaLead(player)}${fallback[Math.floor(Math.random() * fallback.length)]}`;
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

function publicNoteConsensus(state: UndercoverGameState, player: UndercoverPlayerState): number {
  return state.publicNotes.reduce((score, note) => (note.content.includes(player.nickname) ? score + 1 : score), 0);
}

function undercoverVoteScore(state: UndercoverGameState, player: UndercoverPlayerState, outliers: Map<string, number>): number {
  return player.suspicion * 2 + (outliers.get(player.playerId) ?? 0) * 4 + publicNoteConsensus(state, player);
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
    const outliers = analyzeDescriptionOutliers(state);
    const scored = [...civilians]
      .map((candidate) => ({
        player: candidate,
        score: undercoverVoteScore(state, candidate, outliers),
      }))
      .sort((a, b) => b.score - a.score);
    const aliveCount = alive.length;
    if (aliveCount <= 3) {
      return { targetId: scored[0].player.playerId };
    }
    if (player.persona === '稳健跟随型') {
      return { targetId: scored[0].player.playerId };
    }
    if (player.persona === '大胆误导型') {
      if (scored.length > 1 && Math.random() < 0.45) {
        return { targetId: scored[1].player.playerId };
      }
      if (Math.random() < 0.2) {
        return { targetId: scored[scored.length - 1].player.playerId };
      }
      return { targetId: scored[0].player.playerId };
    }
    return { targetId: scored[0].player.playerId };
  }

  // 平民：综合嫌疑值和描述偏离度投票
  const outliers = analyzeDescriptionOutliers(state);
  const scored = alive.map((p) => ({
    player: p,
    score: undercoverVoteScore(state, p, outliers),
  }));
  scored.sort((a, b) => b.score - a.score);

  if (player.persona === '谨慎试探型') {
    const gap = (scored[0]?.score ?? 0) - (scored[1]?.score ?? 0);
    if ((scored[0]?.score ?? 0) < 1.5 || gap < 0.6) return { targetId: null };
    return { targetId: scored[0].player.playerId };
  }
  if (player.persona === '联想发散型') {
    const sortedByOutlier = [...alive].sort((a, b) => (outliers.get(b.playerId) ?? 0) - (outliers.get(a.playerId) ?? 0));
    const outlierTarget = sortedByOutlier[0];
    if (outlierTarget && (outliers.get(outlierTarget.playerId) ?? 0) > 0.22) {
      return { targetId: outlierTarget.playerId };
    }
  }
  if (player.persona === '稳健跟随型') {
    return { targetId: scored[0]?.player.playerId ?? null };
  }
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
      seatNumber: getSeatNumber(state, p.playerId),
      isAlive: p.isAlive,
      persona: finished ? p.persona : p.playerId === playerId ? p.persona : undefined,
      role: finished ? p.role : undefined,
      word: finished ? p.word : undefined,
      isMe: p.playerId === playerId,
      hasDescribed: p.hasDescribed,
    })),
    myWord: me?.word,
    myRole: me?.role,
    myPersona: me?.persona,
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
    publicNotes: state.publicNotes,
    events: state.events,
  };
}
