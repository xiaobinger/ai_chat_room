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
function wordHints(word: string): { place: string; feeling: string; color: string } {
  const places = ['超市', '家里', '街上', '学校', '办公室', '厨房', '商场'];
  const feelings = ['熟悉', '亲切', '放松', '日常', '温暖', '特别'];
  const colors = ['红色', '白色', '蓝色', '透明', '彩色', '暖色'];
  let hash = 0;
  for (const ch of word) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return {
    place: places[hash % places.length],
    feeling: feelings[(hash >> 2) % feelings.length],
    color: colors[(hash >> 4) % colors.length],
  };
}

/** AI 描述自己的词（不直接说出词） */
export function generateUndercoverDescription(state: UndercoverGameState, player: UndercoverPlayerState): string {
  const hints = wordHints(player.word);
  const templates = [
    `我想到的东西在${hints.place}经常能见到。`,
    `它给我的感觉是${hints.feeling}的。`,
    `如果要给它一个颜色，我觉得是${hints.color}。`,
    `我身边不少朋友都喜欢它。`,
    `它是我生活里很常见的东西。`,
    `说到它，我脑海里有一幅具体的画面。`,
    `它通常和某个特定的场景联系在一起。`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

/** AI 投票：卧底投平民，平民按嫌疑投票 */
export function decideUndercoverVote(
  state: UndercoverGameState,
  player: UndercoverPlayerState,
): { targetId: string | null } {
  const alive = getAlivePlayers(state).filter((p) => p.playerId !== player.playerId);
  if (alive.length === 0) return { targetId: null };

  if (player.role === 'undercover') {
    const civilians = alive.filter((p) => p.role === 'civilian');
    if (civilians.length === 0) return { targetId: null };
    // 卧底倾向投嫌疑低的平民，避免暴露
    const sorted = [...civilians].sort((a, b) => a.suspicion - b.suspicion);
    return { targetId: sorted[0].playerId };
  }

  // 平民：投嫌疑最高的（自己视角不知道谁是卧底，只看历史投票和直觉）
  const sorted = [...alive].sort((a, b) => b.suspicion - a.suspicion);
  if (sorted[0] && sorted[0].suspicion > 0) return { targetId: sorted[0].playerId };
  if (Math.random() < 0.15) return { targetId: null };
  return { targetId: sorted[0].playerId };
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
