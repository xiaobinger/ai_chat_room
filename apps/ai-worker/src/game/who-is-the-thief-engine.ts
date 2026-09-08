import type {
  ThiefGameState,
  ThiefPlayerState,
  ThiefRole,
  ThiefGameEvent,
} from './who-is-the-thief-types';
import { STOLEN_ITEMS, CRIME_SCENES, CLUES, SPECIAL_EVENTS } from './who-is-the-thief-types';
import { GameError } from './errors';

const pick = <T>(list: T[]): T | undefined =>
  list.length > 0 ? list[Math.floor(Math.random() * list.length)] : undefined;

function shuffle<T>(list: T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** 根据玩家数量分配角色 */
export function assignThiefRoles(playerIds: string[]): Record<string, ThiefRole> {
  const count = playerIds.length;
  const roles: ThiefRole[] = ['thief', 'detective'];

  // 30% 概率普通小偷升级为神偷（8 人以上）
  if (count >= 8 && Math.random() < 0.3) {
    roles[0] = 'master_thief';
  }
  if (count >= 5) roles.push('witness');
  if (count >= 6 && Math.random() < 0.5) roles.push('accomplice');
  while (roles.length < count) roles.push('citizen');

  const shuffled = shuffle(roles);
  const assignments: Record<string, ThiefRole> = {};
  playerIds.forEach((id, index) => {
    assignments[id] = shuffled[index];
  });
  return assignments;
}

function logEvent(
  state: ThiefGameState,
  type: ThiefGameEvent['type'],
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

function findPlayer(state: ThiefGameState, playerId: string): ThiefPlayerState {
  const player = state.players.find((p) => p.playerId === playerId);
  if (!player) throw new GameError('player_not_found', '玩家不存在');
  return player;
}

export function getAlivePlayers(state: ThiefGameState): ThiefPlayerState[] {
  return state.players.filter((p) => p.isAlive);
}

export function getThiefTeam(state: ThiefGameState): ThiefPlayerState[] {
  return state.players.filter((p) => p.isAlive && state.thiefTeamIds.includes(p.playerId));
}

export function getCitizenTeam(state: ThiefGameState): ThiefPlayerState[] {
  return state.players.filter((p) => p.isAlive && !state.thiefTeamIds.includes(p.playerId));
}

/** 初始化游戏状态 */
export function initThiefGameState(
  players: { playerId: string; nickname: string }[],
): ThiefGameState {
  if (players.length < 4) throw new GameError('not_enough_players', '谁是凶手至少需要 4 名玩家');

  const assignments = assignThiefRoles(players.map((p) => p.playerId));
  const playerStates: ThiefPlayerState[] = players.map((p) => ({
    playerId: p.playerId,
    nickname: p.nickname,
    role: assignments[p.playerId],
    isAlive: true,
    hasSpoken: false,
    hasInvestigated: false,
    suspicion: 0,
    hasFramed: false,
    hasRevealedClue: false,
  }));

  const thiefTeamIds = playerStates
    .filter((p) => p.role === 'thief' || p.role === 'master_thief' || p.role === 'accomplice')
    .map((p) => p.playerId);

  const stolenItem = pick(STOLEN_ITEMS)!;
  const crimeScene = pick(CRIME_SCENES)!;
  const clueCount = 2 + Math.floor(Math.random() * 2);
  const clues = shuffle(CLUES).slice(0, clueCount);

  return {
    format: 2,
    phase: 'investigation',
    round: 1,
    players: playerStates,
    thiefTeamIds,
    speechLog: [],
    privateNotes: {},
    revealedClues: [],
    votes: {},
    voteStatus: {},
    stolenItem,
    crimeScene,
    clues,
    masterThiefEscapeUsed: false,
    events: [
      {
        id: crypto.randomUUID(),
        round: 1,
        phase: 'investigation',
        type: 'game_start',
        content: `案件通报：${crimeScene}失窃物品：${stolenItem}。小偷就藏在我们 ${players.length} 个人之中，请大家轮流发言，找出真凶！`,
        timestamp: Date.now(),
      },
    ],
  };
}

// ===== 调查阶段动作 =====

/** 公开发言 */
export function applyThiefSpeech(state: ThiefGameState, playerId: string, content: string): void {
  if (state.phase !== 'investigation') throw new GameError('not_investigation', '当前不是讨论阶段');
  const player = findPlayer(state, playerId);
  if (!player.isAlive) throw new GameError('player_dead', '你已出局');
  if (player.hasSpoken) throw new GameError('already_spoken', '本轮已发言');

  const text = content.trim().slice(0, 200);
  if (!text) throw new GameError('empty_speech', '发言不能为空');

  player.hasSpoken = true;
  state.speechLog.push({ round: state.round, playerId, nickname: player.nickname, content: text });
  logEvent(state, 'player_action', `${player.nickname}：${text}`, player.nickname);
}

/** 沉默 */
export function applyThiefSkip(state: ThiefGameState, playerId: string): void {
  if (state.phase !== 'investigation') throw new GameError('not_investigation', '当前不是讨论阶段');
  const player = findPlayer(state, playerId);
  if (!player.isAlive) throw new GameError('player_dead', '你已出局');
  if (player.hasSpoken) throw new GameError('already_spoken', '本轮已发言');

  player.hasSpoken = true;
  logEvent(state, 'player_action', `${player.nickname} 保持沉默`, player.nickname);
}

/** 侦探调查（结果只有侦探可见） */
export function applyDetectiveInvestigate(state: ThiefGameState, detectiveId: string, targetId: string): void {
  if (state.phase !== 'investigation') throw new GameError('not_investigation', '当前不是讨论阶段');
  const detective = findPlayer(state, detectiveId);
  if (!detective.isAlive) throw new GameError('player_dead', '你已出局');
  if (detective.role !== 'detective') throw new GameError('not_detective', '你不是侦探');
  if (detective.hasInvestigated) throw new GameError('already_investigated', '本轮已调查过');

  const target = findPlayer(state, targetId);
  if (!target.isAlive) throw new GameError('target_dead', '目标已出局');
  if (targetId === detectiveId) throw new GameError('cannot_investigate_self', '不能调查自己');

  detective.hasInvestigated = true;
  const isThief = state.thiefTeamIds.includes(targetId) &&
    (target.role === 'thief' || target.role === 'master_thief');
  const note = `第 ${state.round} 轮调查：${target.nickname} ${isThief ? '就是小偷！' : '不是小偷。'}`;
  if (!state.privateNotes[detectiveId]) state.privateNotes[detectiveId] = [];
  state.privateNotes[detectiveId].push(note);
  logEvent(state, 'player_action', `侦探 ${detective.nickname} 调查了 ${target.nickname}（结果只有侦探知道）`, detective.nickname, target.nickname);
}

/** 小偷嫁祸（悄悄增加目标嫌疑，只有小偷知道） */
export function applyFrame(state: ThiefGameState, thiefId: string, targetId: string): void {
  const thief = findPlayer(state, thiefId);
  if (!thief.isAlive) throw new GameError('player_dead', '你已出局');
  if (thief.role !== 'thief' && thief.role !== 'master_thief') throw new GameError('not_thief', '你不是小偷');
  if (thief.hasFramed) throw new GameError('already_framed', '嫁祸机会已用完');
  if (state.thiefTeamIds.includes(targetId)) throw new GameError('cannot_frame_teammate', '不能嫁祸同伙');

  const target = findPlayer(state, targetId);
  if (!target.isAlive) throw new GameError('target_dead', '目标已出局');

  thief.hasFramed = true;
  target.suspicion += 2;
  // 不写公开事件：嫁祸是暗中进行的
  if (!state.privateNotes[thiefId]) state.privateNotes[thiefId] = [];
  state.privateNotes[thiefId].push(`你悄悄嫁祸了 ${target.nickname}，增加了 TA 的嫌疑。`);
}

/** 目击者公开线索（整局一次） */
export function applyRevealClue(state: ThiefGameState, witnessId: string): void {
  const witness = findPlayer(state, witnessId);
  if (!witness.isAlive) throw new GameError('player_dead', '你已出局');
  if (witness.role !== 'witness') throw new GameError('not_witness', '你不是目击者');
  if (witness.hasRevealedClue) throw new GameError('already_revealed', '线索已公开过');

  const unrevealed = state.clues.filter((c) => !state.revealedClues.includes(c));
  if (unrevealed.length === 0) throw new GameError('no_clues_left', '所有线索都已公开');

  const clue = pick(unrevealed)!;
  witness.hasRevealedClue = true;
  state.revealedClues.push(clue);
  logEvent(state, 'clue_found', `目击者 ${witness.nickname} 公开了线索：${clue}`, witness.nickname);
}

/** 发言结束 → 进入投票 */
export function startThiefVoting(state: ThiefGameState): void {
  if (state.phase !== 'investigation') throw new GameError('not_investigation', '当前不是讨论阶段');
  state.phase = 'voting';
  state.votes = {};
  state.voteStatus = {};
  logEvent(state, 'phase_change', `第 ${state.round} 轮讨论结束，进入投票`);
}

/** 投票 */
export function applyThiefVote(state: ThiefGameState, playerId: string, targetId: string | null): void {
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

/** 检查胜负 */
export function checkThiefVictory(state: ThiefGameState): 'thief' | 'citizen' | null {
  const thiefTeam = getThiefTeam(state).length;
  const citizenTeam = getCitizenTeam(state).length;
  if (thiefTeam === 0) return 'citizen';
  if (thiefTeam >= citizenTeam) return 'thief';
  return null;
}

/** 结算投票 → 淘汰/神偷逃脱/平票 → 胜负或下一轮 */
export function resolveThiefVote(state: ThiefGameState): void {
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
    logEvent(state, 'vote_result', '平票，本轮无人出局');
  } else {
    const target = findPlayer(state, eliminated);
    // 神偷金蝉脱壳（整局一次）
    if (target.role === 'master_thief' && !state.masterThiefEscapeUsed) {
      state.masterThiefEscapeUsed = true;
      logEvent(state, 'special_event', `金蝉脱壳！${target.nickname} 是神偷，成功逃脱了本次投票！`, undefined, target.nickname);
    } else {
      target.isAlive = false;
      state.accusedPlayerId = eliminated;
      const roleLabel = target.role === 'thief' ? '小偷' : target.role === 'master_thief' ? '神偷' : target.role === 'accomplice' ? '同伙' : target.role === 'detective' ? '侦探' : target.role === 'witness' ? '目击者' : '普通市民';
      logEvent(state, 'vote_result', `${target.nickname} 以 ${maxVotes} 票被投票出局！身份是：${roleLabel}`, undefined, target.nickname);
    }
  }

  const winner = checkThiefVictory(state);
  if (winner) {
    state.winner = winner;
    state.phase = 'result';
    const thiefNames = state.players
      .filter((p) => state.thiefTeamIds.includes(p.playerId))
      .map((p) => `${p.nickname}（${p.role === 'master_thief' ? '神偷' : p.role === 'accomplice' ? '同伙' : '小偷'}）`)
      .join('、');
    logEvent(state, 'game_end', winner === 'citizen' ? `市民胜利！小偷阵营是：${thiefNames}` : `小偷阵营获胜！小偷是：${thiefNames}`);
    return;
  }

  nextInvestigationRound(state);
}

/** 进入下一轮调查 */
export function nextInvestigationRound(state: ThiefGameState): void {
  state.phase = 'investigation';
  state.round += 1;
  state.votes = {};
  state.voteStatus = {};
  state.accusedPlayerId = undefined;
  for (const p of state.players) {
    p.hasSpoken = false;
    p.hasInvestigated = false;
  }

  // 随机彩蛋
  if (Math.random() < 0.3) {
    const keys = Object.keys(SPECIAL_EVENTS) as (keyof typeof SPECIAL_EVENTS)[];
    const event = SPECIAL_EVENTS[pick(keys)!];
    logEvent(state, 'special_event', `彩蛋事件「${event.label}」：${event.description}`);
  }

  logEvent(state, 'phase_change', `第 ${state.round} 轮调查开始，请大家轮流发言`);
}

// ===== AI 行为 =====

/** AI 调查发言 */
export function generateInvestigationSpeech(
  state: ThiefGameState,
  player: ThiefPlayerState,
): string {
  const alive = getAlivePlayers(state).filter((p) => p.playerId !== player.playerId);
  const target = pick(alive);

  if ((player.role === 'thief' || player.role === 'master_thief') && target) {
    const templates = [
      `我觉得 ${target.nickname} 的表现很可疑，一直在转移话题。`,
      `我注意到 ${target.nickname} 对案件细节了解得太多了。`,
      `${target.nickname} 刚才的回答有些前后矛盾。`,
      `我怀疑 ${target.nickname}，TA 的眼神在闪躲。`,
    ];
    return pick(templates)!;
  }
  if (player.role === 'accomplice' && target) {
    const templates = [
      `大家不应该只关注一个人，${target.nickname} 也有嫌疑。`,
      `我觉得应该多听听 ${target.nickname} 的说法。`,
      `${target.nickname} 刚才的发言有些奇怪。`,
    ];
    return pick(templates)!;
  }
  if (player.role === 'detective' && target) {
    const templates = [
      `根据我的调查，${target.nickname} 需要解释一下刚才的发言。`,
      `我掌握了一些线索，${target.nickname} 请回答我的问题。`,
      `从目前的证据来看，${target.nickname} 的嫌疑不能排除。`,
    ];
    return pick(templates)!;
  }
  if (player.role === 'witness') {
    const templates = [
      `我注意到了一些不寻常的细节，稍后和大家分享。`,
      `根据我的观察，事情可能不是表面看起来那样。`,
      `我有一条线索想和大家分享，但我需要再确认一下。`,
    ];
    return pick(templates)!;
  }
  if (target) {
    const templates = [
      `我觉得 ${target.nickname} 的发言有些可疑。`,
      `我同意侦探的看法，${target.nickname} 需要解释一下。`,
      `从目前的线索来看，${target.nickname} 不能排除嫌疑。`,
      `我注意到 ${target.nickname} 一直在回避关键问题。`,
    ];
    return pick(templates)!;
  }
  return '我暂时没有特别的看法。';
}

/** AI 侦探调查目标：随机存活非自己 */
export function decideDetectiveTarget(state: ThiefGameState, detective: ThiefPlayerState): string | undefined {
  const targets = getAlivePlayers(state).filter((p) => p.playerId !== detective.playerId);
  return pick(targets)?.playerId;
}

/** AI 投票 */
export function decideThiefVote(
  state: ThiefGameState,
  player: ThiefPlayerState,
): { targetId: string | null } {
  const alive = getAlivePlayers(state).filter((p) => p.playerId !== player.playerId);
  if (alive.length === 0) return { targetId: null };

  if (state.thiefTeamIds.includes(player.playerId)) {
    // 小偷阵营：投非小偷阵营（优先嫌疑高的，推波助澜）
    const citizens = alive.filter((p) => !state.thiefTeamIds.includes(p.playerId));
    if (citizens.length === 0) return { targetId: null };
    const sorted = [...citizens].sort((a, b) => b.suspicion - a.suspicion);
    return { targetId: sorted[0].playerId };
  }

  // 好人阵营：按嫌疑投票（侦探若有查杀信息在 privateNotes 里，无法结构化读取，退化为嫌疑启发）
  const sorted = [...alive].sort((a, b) => b.suspicion - a.suspicion);
  if (sorted[0] && sorted[0].suspicion > 0) return { targetId: sorted[0].playerId };
  if (Math.random() < 0.1) return { targetId: null };
  return { targetId: sorted[0].playerId };
}

/** AI 目击者是否公开线索（嫌疑信息不足时更倾向公开） */
export function decideWitnessReveal(state: ThiefGameState): boolean {
  return state.revealedClues.length === 0 && Math.random() < 0.5;
}

/** AI 小偷嫁祸目标 */
export function decideFrameTarget(state: ThiefGameState, thief: ThiefPlayerState): string | undefined {
  const targets = getAlivePlayers(state).filter(
    (p) => !state.thiefTeamIds.includes(p.playerId) && p.playerId !== thief.playerId,
  );
  const sorted = [...targets].sort((a, b) => b.suspicion - a.suspicion);
  return (sorted[0] ?? pick(targets))?.playerId;
}

/** 玩家视角 */
export function getThiefView(state: ThiefGameState, playerId: string | null) {
  const me = playerId ? state.players.find((p) => p.playerId === playerId) : undefined;
  const finished = state.phase === 'result';

  return {
    format: state.format,
    phase: state.phase,
    round: state.round,
    game: 'who_is_the_thief',
    players: state.players.map((p) => ({
      playerId: p.playerId,
      nickname: p.nickname,
      isAlive: p.isAlive,
      role: finished ? p.role : p.playerId === playerId ? p.role : undefined,
      isMe: p.playerId === playerId,
      hasSpoken: p.hasSpoken,
    })),
    myRole: me?.role,
    stolenItem: state.stolenItem,
    crimeScene: state.crimeScene,
    revealedClues: state.revealedClues,
    speechLog: state.speechLog,
    myNotes: playerId ? state.privateNotes[playerId] ?? [] : [],
    voteStatus: state.voteStatus,
    votes: state.phase === 'voting' ? {} : state.votes,
    accusedPlayerId: state.accusedPlayerId,
    winner: state.winner,
    events: state.events,
  };
}
