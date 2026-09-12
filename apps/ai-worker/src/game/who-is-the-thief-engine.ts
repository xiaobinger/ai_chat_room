import type {
  ThiefGameState,
  ThiefPlayerState,
  ThiefRole,
  ThiefGameEvent,
  ThiefPersona,
} from './who-is-the-thief-types';
import { STOLEN_ITEMS, CRIME_SCENES, CLUES, SPECIAL_EVENTS } from './who-is-the-thief-types';
import { GameError } from './errors';
import { generateRandomVoiceProfile } from './speech-generator';

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

function getSeatNumber(state: ThiefGameState, playerId: string): number | null {
  const index = state.players.findIndex((player) => player.playerId === playerId);
  return index >= 0 ? index + 1 : null;
}

function mentionCount(state: ThiefGameState, player: ThiefPlayerState): number {
  return state.speechLog.filter((speech) => speech.content.includes(player.nickname)).length;
}

function publicNotePressure(state: ThiefGameState, player: ThiefPlayerState): number {
  return state.publicNotes.reduce((score, note) => (note.content.includes(player.nickname) ? score + 1 : score), 0);
}

function cluePressure(state: ThiefGameState, player: ThiefPlayerState): number {
  return state.revealedClues.reduce((score, clue) => {
    if (clue.includes(player.nickname)) return score + 2;
    if (clue.includes('内鬼') && (player.role === 'citizen' || player.role === 'detective')) return score + 1;
    return score;
  }, 0);
}

function recentSpeechFocus(state: ThiefGameState, excludePlayerId?: string): ThiefPlayerState | undefined {
  const recent = [...state.speechLog].reverse().find((speech) => speech.playerId !== excludePlayerId);
  if (!recent) return undefined;
  const alive = getAlivePlayers(state).filter((player) => player.playerId !== excludePlayerId);
  return alive.find((player) => recent.content.includes(player.nickname));
}

function thiefPublicScore(state: ThiefGameState, player: ThiefPlayerState): number {
  return player.suspicion * 2 + mentionCount(state, player) + publicNotePressure(state, player) + cluePressure(state, player);
}

function publicFocusTarget(state: ThiefGameState, excludePlayerId?: string): ThiefPlayerState | undefined {
  const alive = getAlivePlayers(state).filter((player) => player.playerId !== excludePlayerId);
  return [...alive].sort((a, b) => thiefPublicScore(state, b) - thiefPublicScore(state, a))[0];
}

const THIEF_PERSONAS: ThiefPersona[] = ['冷静观察型', '强势带队型', '圆滑周旋型', '直觉冲票型'];

function rememberPublicNote(state: ThiefGameState, content: string): void {
  const trimmed = content.trim();
  if (!trimmed) return;
  const last = state.publicNotes[state.publicNotes.length - 1];
  if (last?.content === trimmed && last.round === state.round) return;
  state.publicNotes.push({ round: state.round, content: trimmed });
}

function personaLead(player: ThiefPlayerState): string {
  switch (player.persona) {
    case '冷静观察型':
      return '我先把能对上的信息摆出来。';
    case '强势带队型':
      return '我先把结论放前面。';
    case '圆滑周旋型':
      return '我先不把话说死，但有些点确实不对。';
    case '直觉冲票型':
      return '我现在的第一反应很强烈。';
    default:
      return '我先说我的判断。';
  }
}

function assignThiefPersona(role: ThiefRole): ThiefPersona {
  if (role === 'detective') return '冷静观察型';
  if (role === 'witness') return '冷静观察型';
  if (role === 'accomplice') return '圆滑周旋型';
  if (role === 'thief' || role === 'master_thief') return Math.random() < 0.5 ? '圆滑周旋型' : '强势带队型';
  return pick(THIEF_PERSONAS) ?? '冷静观察型';
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
  if (players.length < 4) throw new GameError('not_enough_players', '谁是小偷至少需要 4 名玩家');

  const assignments = assignThiefRoles(players.map((p) => p.playerId));
  const playerStates: ThiefPlayerState[] = players.map((p) => ({
    playerId: p.playerId,
    nickname: p.nickname,
    role: assignments[p.playerId],
      persona: assignThiefPersona(assignments[p.playerId]),
    isAlive: true,
    hasSpoken: false,
    hasInvestigated: false,
    suspicion: 0,
    hasFramed: false,
    hasRevealedClue: false,
    voiceProfile: generateRandomVoiceProfile(p.playerId),
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
    publicNotes: [{ round: 1, content: `案件开始：失窃物品是${stolenItem}，所有人先围绕现场和不在场证明发言。` }],
    events: [
      {
        id: crypto.randomUUID(),
        round: 1,
        phase: 'investigation',
        type: 'game_start',
        content: `案件通报：${crimeScene}失窃物品：${stolenItem}。小偷就藏在我们 ${players.length} 个人之中，请大家轮流发言，找出真正的小偷！`,
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
  // 调查动作匿名化：只写结果到私密笔记，不公开侦探身份与调查对象
  logEvent(state, 'player_action', '有人暗中调查了一名玩家，调查结果只有本人可见。');
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
  const focus = publicFocusTarget(state);
  const clueSummary = state.revealedClues.length > 0 ? `已公开线索 ${state.revealedClues.length} 条。` : '当前还没有公开线索。';
  const focusSummary = focus ? `目前场上最受关注的是 ${focus.nickname}。` : '场上焦点仍不够集中。';
  rememberPublicNote(state, `${clueSummary}${focusSummary}`);
  logEvent(state, 'phase_change', `第 ${state.round} 轮讨论结束，进入投票。${clueSummary}${focusSummary}`);
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
  if (voteSummary) rememberPublicNote(state, `第 ${state.round} 轮投票分布：${voteSummary}`);

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
    state.consecutiveTies = (state.consecutiveTies ?? 0) + 1;
    logEvent(state, 'vote_result', `平票，本轮无人出局（连续僵局第 ${state.consecutiveTies} 轮）`);
    if (state.consecutiveTies >= 3) {
      resolveThiefTiebreak(state);
      // 不在这里 return：强制出局后仍需走统一的「胜负判定 + 进入下一轮」收尾
    }
  } else {
    state.consecutiveTies = 0;
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

/**
 * 连续 3 轮平票僵局：按累计嫌疑度最高者强制出局，打破僵局。
 * 与谁是卧底的 resolveTiebreak 同一套兜底：AI 票型可能长期对称
 * （实测约 1.7% 的全 AI 对局会陷入 2:2 平票死循环，80 轮都不收敛），
 * 不加兜底对局将永不结束。
 */
function resolveThiefTiebreak(state: ThiefGameState): void {
  state.consecutiveTies = 0;
  const alive = getAlivePlayers(state);
  if (alive.length === 0) return;
  const sorted = [...alive].sort(
    (a, b) => b.suspicion - a.suspicion || (a.nickname > b.nickname ? 1 : -1),
  );
  const target = sorted[0];
  // 神偷的逃脱在强制结算时同样生效（整局一次）
  if (target.role === 'master_thief' && !state.masterThiefEscapeUsed) {
    state.masterThiefEscapeUsed = true;
    logEvent(state, 'special_event', `金蝉脱壳！${target.nickname} 是神偷，在强制结算中逃脱！`, undefined, target.nickname);
    return;
  }
  target.isAlive = false;
  state.accusedPlayerId = target.playerId;
  const roleLabel = target.role === 'thief' ? '小偷' : target.role === 'master_thief' ? '神偷' : target.role === 'accomplice' ? '同伙' : target.role === 'detective' ? '侦探' : target.role === 'witness' ? '目击者' : '普通市民';
  logEvent(state, 'vote_result', `连续平票僵局，${target.nickname} 因累计嫌疑最高被强制出局！身份是：${roleLabel}`, undefined, target.nickname);
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

  const focus = publicFocusTarget(state);
  rememberPublicNote(
    state,
    focus
      ? `第 ${state.round} 轮重新调查，当前焦点仍是 ${focus.nickname}。别忽略侦探笔记和已公开线索。`
      : `第 ${state.round} 轮重新调查，场上没有绝对焦点，谁先带节奏谁就更值得留意。`,
  );
  logEvent(
    state,
    'phase_change',
    `第 ${state.round} 轮调查开始，请大家轮流发言${focus ? `。上一轮最受怀疑的是 ${focus.nickname}` : ''}，别忽略侦探笔记和公开线索。`,
  );
}

// ===== AI 行为 =====

/** AI 调查发言 */
export function generateInvestigationSpeech(
  state: ThiefGameState,
  player: ThiefPlayerState,
): string {
  const alive = getAlivePlayers(state).filter((p) => p.playerId !== player.playerId);
  if (alive.length === 0) return '目前没有更多信息，等待下一轮。';

  const sortedBySuspicion = [...alive].sort((a, b) => b.suspicion - a.suspicion);
  const topSuspect = sortedBySuspicion[0];
  const midSuspects = sortedBySuspicion.filter((p) => p.suspicion > 0 && p !== topSuspect).slice(0, 2);
  const lastSpeakers = state.speechLog.filter((s) => s.playerId !== player.playerId).slice(-3);
  const latestClue = state.revealedClues[state.revealedClues.length - 1];
  const publicFocus = publicFocusTarget(state, player.playerId);
  const recentFocus = recentSpeechFocus(state, player.playerId);

  // ---- 侦探：已知查验结果，据此发言 ----
  if (player.role === 'detective') {
    const confirmedInnocent = parseInvestigationVerdicts(state, player.playerId, '不是小偷')
      .map((id) => state.players.find((p) => p.playerId === id)?.nickname)
      .filter((n): n is string => Boolean(n));
    const confirmedThief = parseInvestigationVerdicts(state, player.playerId, '就是小偷')
      .map((id) => state.players.find((p) => p.playerId === id)?.nickname)
      .filter((n): n is string => Boolean(n));

    if (confirmedThief.length > 0) {
      const name = confirmedThief[0]!;
      return `${personaLead(player)}我调查过 ${name}，${name} 就是小偷！请大家把票投给 ${name}，别再被其他人带偏了。`;
    }
    if (confirmedInnocent.length > 0 && topSuspect) {
      const innocentName = confirmedInnocent[0]!;
      return `${personaLead(player)}我查过 ${innocentName}，${innocentName} 是清白的。现在嫌疑最高的是 ${topSuspect.nickname}，我建议重点观察 ${topSuspect.nickname}。`;
    }
    if (latestClue && topSuspect) {
      return `${personaLead(player)}刚公开的线索【${latestClue}】不能白看。现在最该解释的人还是 ${topSuspect.nickname}，我建议把 ${topSuspect.nickname} 放到焦点位。`;
    }
    if (topSuspect) {
      return `${personaLead(player)}目前 ${topSuspect.nickname} 嫌疑最高，我需要再调查其他人来验证。请大家保持警惕。`;
    }
    return `${personaLead(player)}我打算再调查一轮，尽快锁定目标。大家有任何发现请说出来。`;
  }

  // ---- 小偷/神偷：嫁祸高嫌疑但非队友的人 ----
  if (player.role === 'thief' || player.role === 'master_thief') {
    const nonThiefTargets = alive.filter((p) => !state.thiefTeamIds.includes(p.playerId));
    const bestFrame = nonThiefTargets.filter((p) => p.suspicion > 0).sort((a, b) => b.suspicion - a.suspicion)[0] ?? nonThiefTargets[0];
    if (bestFrame) {
      const frameReasons = [
        `我觉得 ${bestFrame.nickname} 太紧张了，一直在看其他人，明显在掩饰什么。`,
        `我注意到 ${bestFrame.nickname} 对现场细节的反应很奇怪，不太对劲。`,
        `你们没发现吗？${bestFrame.nickname} 的发言前后矛盾，${bestFrame.nickname} 一定有问题。`,
        `${bestFrame.nickname} 一直在转移话题，我觉得 ${bestFrame.nickname} 很可疑。`,
      ];
      // 如果 lastSpeakers 里有提到某人，可以呼应
      if (lastSpeakers.length > 0) {
        const recent = lastSpeakers[lastSpeakers.length - 1]!;
        if (recent.playerId !== bestFrame.playerId) {
          return `${personaLead(player)}我同意 ${recent.nickname} 的看法，${bestFrame.nickname} 确实很可疑，${bestFrame.nickname} 需要解释一下。`;
        }
      }
      if (latestClue) {
        return `${personaLead(player)}大家别忘了刚才那条线索【${latestClue}】。要我说，这条线索和 ${bestFrame.nickname} 的表现根本对得上。`;
      }
      return `${personaLead(player)}${pick(frameReasons)!}`;
    }
    return `${personaLead(player)}大家都挺正常的，但我感觉有人在演戏。`;
  }

  // ---- 同伙：保队友、挑别人 ----
  if (player.role === 'accomplice') {
    const teammate = alive.find((p) => state.thiefTeamIds.includes(p.playerId));
    if (teammate && topSuspect && topSuspect.playerId !== teammate.playerId) {
      return `${personaLead(player)}我觉得真正可疑的是 ${topSuspect.nickname}，${teammate.nickname} 一直很冷静，不要转移目标。`;
    }
    if (topSuspect) {
      return `${personaLead(player)}${topSuspect.nickname} 最近表现很奇怪，建议大家多留意。`;
    }
    return `${personaLead(player)}我没什么特别怀疑的，大家先别急着投票。`;
  }

  // ---- 目击者：分享线索或提示 ----
  if (player.role === 'witness') {
    if (state.revealedClues.length > 0) {
      const lastClue = state.revealedClues[state.revealedClues.length - 1];
      return `${personaLead(player)}关于那条线索【${lastClue}】，我觉得它不是巧合。谁最想淡化这条线索，谁就更值得被盯住。`;
    }
    if (topSuspect) {
      return `${personaLead(player)}我观察到 ${topSuspect.nickname} 的行为有些异常，希望能找出更多证据。`;
    }
    return `${personaLead(player)}我正在观察每个人的反应，稍后会有发现。`;
  }

  // ---- 普通市民：结合嫌疑和发言推理 ----
  if (player.persona === '冷静观察型' && publicFocus) {
    return `${personaLead(player)}我先看公开信息：${publicFocus.nickname} 被提到最多，场上总结也一直绕着 TA 转，这个位置最值得继续追问。`;
  }
  if (player.persona === '强势带队型' && topSuspect) {
    return `${personaLead(player)}这一轮我就直接点名 ${topSuspect.nickname}，先把票型和解释都往 TA 身上压，别再散着聊了。`;
  }
  if (player.persona === '圆滑周旋型' && recentFocus) {
    return `${personaLead(player)}我不急着把话说死，但 ${recentFocus.nickname} 这会儿确实最像需要补解释的人，大家可以先顺着这个点往下聊。`;
  }
  if (player.persona === '直觉冲票型' && (recentFocus ?? topSuspect)) {
    const instinctTarget = recentFocus ?? topSuspect;
    return `${personaLead(player)}我现在最想盯的就是 ${instinctTarget?.nickname}，这种反应不像是单纯紧张，更像在提前给自己找台阶。`;
  }
  if (topSuspect) {
    const reasonTemplates = [
      `${topSuspect.nickname} 嫌疑已经 ${topSuspect.suspicion} 了，大家小心。`,
      `我同意把 ${topSuspect.nickname} 列为重点怀疑对象，${topSuspect.nickname} 需要给出解释。`,
      `${topSuspect.nickname} 一直回避问题，${topSuspect.nickname} 肯定有鬼。`,
    ];
    if (midSuspects.length > 0) {
      const second = midSuspects[0]!;
      return `${personaLead(player)}现在 ${topSuspect.nickname} 和 ${second.nickname} 嫌疑都比较高，但我更怀疑 ${topSuspect.nickname}。`;
    }
    return `${personaLead(player)}${pick(reasonTemplates)!}`;
  }

  // 引用最近发言
  if (lastSpeakers.length > 0) {
    const last = lastSpeakers[lastSpeakers.length - 1]!;
    return `${personaLead(player)}我注意到 ${last.nickname} 刚才说"${last.content.slice(0, 40)}…"，这点很值得思考。`;
  }

  return `${personaLead(player)}目前信息还不够，我需要再观察一轮。`;
}

/** 从侦探私密笔记里解析出判定结果；按完整昵称匹配，避免"AI 玩家 3"这类多词昵称被 `\S+` 只抓到最后一个词 */
function parseInvestigationVerdicts(
  state: ThiefGameState,
  detectiveId: string,
  verdict: '就是小偷' | '不是小偷',
): string[] {
  const notes = state.privateNotes[detectiveId] ?? [];
  const ids: string[] = [];
  for (const note of notes) {
    if (!note.includes(verdict)) continue;
    for (const p of state.players) {
      if (note.includes(`${p.nickname} ${verdict}`)) {
        ids.push(p.playerId);
        break;
      }
    }
  }
  return ids;
}

/** AI 侦探调查目标：优先查高嫌疑但未查过的玩家，随机兜底 */
export function decideDetectiveTarget(state: ThiefGameState, detective: ThiefPlayerState): string | undefined {
  const targets = getAlivePlayers(state).filter((p) => p.playerId !== detective.playerId);
  if (targets.length === 0) return undefined;

  const investigatedIds = new Set([
    ...parseInvestigationVerdicts(state, detective.playerId, '就是小偷'),
    ...parseInvestigationVerdicts(state, detective.playerId, '不是小偷'),
  ]);
  // 未查过的高嫌疑目标
  const uninvestigated = targets.filter((p) => !investigatedIds.has(p.playerId));
  if (uninvestigated.length > 0) {
    const sorted = [...uninvestigated].sort((a, b) => b.suspicion - a.suspicion);
    return sorted[0].playerId;
  }
  // 全部查过了，随机复查
  return pick(targets)?.playerId;
}

/** AI 投票 */
export function decideThiefVote(
  state: ThiefGameState,
  player: ThiefPlayerState,
): { targetId: string | null } {
  const alive = getAlivePlayers(state).filter((p) => p.playerId !== player.playerId);
  if (alive.length === 0) return { targetId: null };
  const publicFocus = publicFocusTarget(state, player.playerId);
  const recentFocus = recentSpeechFocus(state, player.playerId);

  if (state.thiefTeamIds.includes(player.playerId)) {
    // 小偷阵营：优先投非队友中嫌疑最高的，推波助澜
    const citizens = alive.filter((p) => !state.thiefTeamIds.includes(p.playerId));
    if (citizens.length === 0) return { targetId: null };
    const sorted = [...citizens].sort((a, b) => thiefPublicScore(state, b) - thiefPublicScore(state, a));
    if (player.persona === '圆滑周旋型' && publicFocus && !state.thiefTeamIds.includes(publicFocus.playerId)) {
      return { targetId: publicFocus.playerId };
    }
    if (player.persona === '强势带队型' && recentFocus && !state.thiefTeamIds.includes(recentFocus.playerId)) {
      return { targetId: recentFocus.playerId };
    }
    // 最后1轮且自己高嫌疑时，保命优先
    if (sorted.length === 1 && player.suspicion >= 2) {
      return { targetId: sorted[0].playerId };
    }
    return { targetId: sorted[0].playerId };
  }

  // 好人阵营
  if (player.role === 'detective') {
    const confirmedThief = parseInvestigationVerdicts(state, player.playerId, '就是小偷');
    if (confirmedThief.length > 0) {
      const target = alive.find((p) => confirmedThief.includes(p.playerId));
      if (target) return { targetId: target.playerId };
    }
    // 没有确认小偷信息，按嫌疑投票
    const sorted = [...alive].sort((a, b) => thiefPublicScore(state, b) - thiefPublicScore(state, a));
    if (sorted[0] && thiefPublicScore(state, sorted[0]) >= 2) return { targetId: sorted[0].playerId };
    if (Math.random() < 0.15) return { targetId: null };
    return { targetId: sorted[0]?.playerId ?? null };
  }

  // 普通市民：按嫌疑投票，偶有随机
  const sorted = [...alive].sort((a, b) => thiefPublicScore(state, b) - thiefPublicScore(state, a));
  if (player.persona === '冷静观察型') {
    if (sorted[0] && thiefPublicScore(state, sorted[0]) >= 2) return { targetId: sorted[0].playerId };
    return { targetId: null };
  }
  if (player.persona === '强势带队型') {
    return { targetId: (publicFocus ?? sorted[0])?.playerId ?? null };
  }
  if (player.persona === '圆滑周旋型') {
    if (publicFocus && thiefPublicScore(state, publicFocus) >= 1) return { targetId: publicFocus.playerId };
    if (Math.random() < 0.2) return { targetId: null };
  }
  if (player.persona === '直觉冲票型') {
    return { targetId: (recentFocus ?? publicFocus ?? sorted[0])?.playerId ?? null };
  }
  if (sorted[0] && thiefPublicScore(state, sorted[0]) > 0) return { targetId: sorted[0].playerId };
  if (Math.random() < 0.1) return { targetId: null };
  return { targetId: sorted[0]?.playerId ?? null };
}

/** AI 目击者是否公开线索（嫌疑信息不足时更倾向公开） */
export function decideWitnessReveal(state: ThiefGameState): boolean {
  if (state.revealedClues.length > 0) return false;
  const alive = getAlivePlayers(state);
  const top = [...alive].sort((a, b) => b.suspicion - a.suspicion)[0];
  const tiedForTop = top ? alive.filter((player) => player.suspicion === top.suspicion).length > 1 : false;
  return !top || top.suspicion <= 1 || tiedForTop || Math.random() < 0.2;
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
      seatNumber: getSeatNumber(state, p.playerId),
      isAlive: p.isAlive,
      persona: finished ? p.persona : p.playerId === playerId ? p.persona : undefined,
      role: finished ? p.role : p.playerId === playerId ? p.role : undefined,
      isMe: p.playerId === playerId,
      hasSpoken: p.hasSpoken,
      character: p.voiceProfile,
    })),
    myRole: me?.role,
    myPersona: me?.persona,
    stolenItem: state.stolenItem,
    crimeScene: state.crimeScene,
    revealedClues: state.revealedClues,
    speechLog: state.speechLog,
    myNotes: playerId ? state.privateNotes[playerId] ?? [] : [],
    publicNotes: state.publicNotes,
    typingPlayerId: state.typingPlayerId ?? null,
    voteStatus: state.voteStatus,
    votes: state.phase === 'voting' ? {} : state.votes,
    accusedPlayerId: state.accusedPlayerId,
    winner: state.winner,
    events: state.events,
  };
}
