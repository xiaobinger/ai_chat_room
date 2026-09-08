import type { GameState, GameLogEntry, PlayerState, WerewolfRole, SeerCheckResult } from './types';
import { GameError } from './errors';

/** 根据玩家数量分配角色 */
export function assignRoles(playerIds: string[]): Record<string, WerewolfRole> {
  const count = playerIds.length;
  const roles: WerewolfRole[] = [];

  const wolfCount = count <= 8 ? 2 : count <= 11 ? 3 : 4;

  roles.push('seer', 'witch', 'hunter');
  for (let i = 0; i < wolfCount; i++) roles.push('werewolf');
  while (roles.length < count) roles.push('villager');

  // 洗牌
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  const assignments: Record<string, WerewolfRole> = {};
  playerIds.forEach((id, index) => {
    assignments[id] = roles[index];
  });
  return assignments;
}

/** 初始化游戏状态；judgePlayerId 不参与角色分配（房主担任法官模式） */
export function initGameState(
  players: { playerId: string; nickname: string }[],
  judgePlayerId?: string | null,
): GameState {
  const gamePlayers = judgePlayerId
    ? players.filter((p) => p.playerId !== judgePlayerId)
    : players;
  const assignments = assignRoles(gamePlayers.map((p) => p.playerId));

  return {
    format: 2,
    phase: 'night',
    round: 1,
    players: gamePlayers.map((p) => ({
      playerId: p.playerId,
      nickname: p.nickname,
      role: assignments[p.playerId],
      isAlive: true,
      suspicion: 0,
    })),
    wolfVotes: {},
    seerCheckedTonight: [],
    seerChecks: [],
    witchPotions: { save: true, poison: true },
    speechStatus: {},
    dayMessages: [],
    voteStatus: {},
    votes: {},
    deadTonight: [],
    deadToday: [],
    finalSpeeches: {},
    finalSpeechStatus: {},
    judgeMode: undefined,
    judgePlayerId: judgePlayerId ?? undefined,
    events: [
      {
        id: crypto.randomUUID(),
        round: 1,
        phase: 'night',
        type: 'game_start',
        content: `天黑请闭眼。本局共 ${gamePlayers.length} 名玩家，游戏开始！`,
        timestamp: Date.now(),
      },
    ],
  };
}

export function getAlivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.isAlive);
}

export function getAliveWerewolves(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.isAlive && p.role === 'werewolf');
}

export function getAliveVillagers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.isAlive && p.role !== 'werewolf');
}

/** 检查胜利条件 */
export function checkVictory(state: GameState): 'werewolf' | 'villager' | null {
  const wolves = getAliveWerewolves(state).length;
  const villagers = getAliveVillagers(state).length;
  if (wolves === 0) return 'villager';
  if (wolves >= villagers) return 'werewolf';
  return null;
}

function findPlayer(state: GameState, playerId: string): PlayerState {
  const player = state.players.find((p) => p.playerId === playerId);
  if (!player) throw new GameError('player_not_found', '玩家不存在');
  return player;
}

function logEvent(
  state: GameState,
  type: GameLogEntry['type'],
  content: string,
  actorId?: string,
  targetId?: string,
): void {
  const actor = actorId ? state.players.find((p) => p.playerId === actorId) : undefined;
  const target = targetId ? state.players.find((p) => p.playerId === targetId) : undefined;
  state.events.push({
    id: crypto.randomUUID(),
    round: state.round,
    phase: state.phase,
    type,
    actorId,
    actorName: actor?.nickname,
    targetId,
    targetName: target?.nickname,
    content,
    timestamp: Date.now(),
    role: actor?.role,
  });
}

// ===== 夜晚动作 =====

/** 狼人选择击杀目标（多狼各自投票，结算时取多数） */
export function applyWolfKill(state: GameState, wolfId: string, targetId: string): void {
  const wolf = findPlayer(state, wolfId);
  if (state.phase !== 'night') throw new GameError('not_night', '当前不是夜晚阶段');
  if (!wolf.isAlive) throw new GameError('player_dead', '你已出局');
  if (wolf.role !== 'werewolf') throw new GameError('not_werewolf', '你不是狼人');
  const target = findPlayer(state, targetId);
  if (!target.isAlive) throw new GameError('target_dead', '目标已出局');
  if (target.role === 'werewolf') throw new GameError('cannot_kill_teammate', '不能击杀同伴');

  state.wolfVotes[wolfId] = targetId;
  // 同步更新当晚刀口（女巫需要看到）
  state.nightVictim = majorityVote(state.wolfVotes, state);
}

/** 预言家查验 */
export function applySeerCheck(state: GameState, seerId: string, targetId: string): void {
  const seer = findPlayer(state, seerId);
  if (state.phase !== 'night') throw new GameError('not_night', '当前不是夜晚阶段');
  if (!seer.isAlive) throw new GameError('player_dead', '你已出局');
  if (seer.role !== 'seer') throw new GameError('not_seer', '你不是预言家');
  if (state.seerCheckedTonight.includes(targetId)) throw new GameError('already_checked', '该目标今晚已查验');
  const target = findPlayer(state, targetId);
  if (!target.isAlive) throw new GameError('target_dead', '目标已出局');
  if (target.playerId === seerId) throw new GameError('cannot_check_self', '不能查验自己');

  state.seerCheckedTonight.push(targetId);
  const result: SeerCheckResult = {
    round: state.round,
    target: targetId,
    targetName: target.nickname,
    isWerewolf: target.role === 'werewolf',
  };
  state.seerChecks.push(result);
}

/** 女巫用药（save 需在狼刀确定后；pass 为空过） */
export function applyWitchAction(
  state: GameState,
  witchId: string,
  action: 'save' | 'poison' | 'pass',
  targetId?: string,
): void {
  const witch = findPlayer(state, witchId);
  if (state.phase !== 'night') throw new GameError('not_night', '当前不是夜晚阶段');
  if (!witch.isAlive) throw new GameError('player_dead', '你已出局');
  if (witch.role !== 'witch') throw new GameError('not_witch', '你不是女巫');
  if (state.witchTonight) throw new GameError('already_acted', '今晚已经用过药');

  if (action === 'save') {
    if (!state.witchPotions.save) throw new GameError('no_save_potion', '解药已用过');
    if (!state.nightVictim) throw new GameError('no_victim', '今晚暂无被刀目标');
    state.witchTonight = 'save';
    state.witchPotions.save = false;
  } else if (action === 'poison') {
    if (!state.witchPotions.poison) throw new GameError('no_poison_potion', '毒药已用过');
    if (!targetId) throw new GameError('missing_target', '请选择毒杀目标');
    const target = findPlayer(state, targetId);
    if (!target.isAlive) throw new GameError('target_dead', '目标已出局');
    if (targetId === witchId) throw new GameError('cannot_poison_self', '不能毒自己');
    state.witchTonight = 'poison';
    state.witchPoisonTarget = targetId;
    state.witchPotions.poison = false;
  } else {
    state.witchTonight = 'pass';
  }
}

function majorityVote(votes: Record<string, string>, state: GameState): string | undefined {
  const tally: Record<string, number> = {};
  for (const targetId of Object.values(votes)) {
    tally[targetId] = (tally[targetId] ?? 0) + 1;
  }
  const entries = Object.entries(tally);
  if (entries.length === 0) return undefined;
  let max = 0;
  for (const [, count] of entries) max = Math.max(max, count);
  const top = entries.filter(([, count]) => count === max).map(([id]) => id);
  const picked = top[Math.floor(Math.random() * top.length)];
  return state.players.find((p) => p.playerId === picked)?.playerId;
}

/** 结算夜晚：击杀/毒杀/猎人标记 → 有人死亡则进入临终遗言阶段，否则直接进入白天 */
export function resolveNight(state: GameState): void {
  if (state.phase !== 'night') throw new GameError('not_night', '当前不是夜晚阶段');

  const victim = majorityVote(state.wolfVotes, state);
  const saved = state.witchTonight === 'save' && Boolean(victim);
  const poisonTarget = state.witchTonight === 'poison' ? state.witchPoisonTarget : undefined;

  const deaths: string[] = [];
  if (victim && !saved) deaths.push(victim);
  if (poisonTarget && !deaths.includes(poisonTarget)) deaths.push(poisonTarget);

  for (const id of deaths) {
    const p = state.players.find((x) => x.playerId === id);
    if (p) p.isAlive = false;
  }
  state.deadTonight = deaths;

  // 重置夜晚状态
  state.wolfVotes = {};
  state.seerCheckedTonight = [];
  state.witchTonight = undefined;
  state.witchPoisonTarget = undefined;
  state.nightVictim = undefined;

  if (deaths.length > 0) {
    const names = deaths.map((id) => state.players.find((p) => p.playerId === id)?.nickname ?? '未知').join('、');
    logEvent(state, 'player_death', `昨晚倒下了：${names}`);
    // 猎人被刀可以开枪；被毒不能开枪
    const hunterDeath = deaths.find((id) => {
      const p = state.players.find((x) => x.playerId === id);
      return p?.role === 'hunter' && id !== poisonTarget;
    });
    if (hunterDeath) state.pendingHunter = hunterDeath;

    // 进入临终遗言阶段
    state.phase = 'final_speech';
    state.finalSpeechStatus = {};
    logEvent(state, 'phase_change', `天亮了。${names} 可以发表临终遗言。`);
  } else {
    logEvent(state, 'player_death', saved ? '女巫救下了今晚被刀的人，平安夜！' : '昨晚是平安夜，无人死亡');
    // 无人死亡，直接进入白天
    enterDayPhase(state);
  }

  checkGameEnd(state);
}

/** 进入白天阶段（重置白天状态） */
export function enterDayPhase(state: GameState): void {
  state.phase = 'day';
  state.speechStatus = {};
  state.dayMessages = [];
  state.finalSpeechStatus = {};
  logEvent(state, 'phase_change', `第 ${state.round} 天 天亮了`);
}

// ===== 白天动作 =====

/** 白天发言 */
export function applyDaySpeak(state: GameState, playerId: string, content: string): void {
  const player = findPlayer(state, playerId);
  if (state.phase !== 'day') throw new GameError('not_day', '当前不是白天发言阶段');
  if (!player.isAlive) throw new GameError('player_dead', '你已出局');
  if (state.speechStatus[playerId]) throw new GameError('already_spoken', '本轮已发言');

  const text = content.trim().slice(0, 200);
  if (!text) throw new GameError('empty_speech', '发言不能为空');

  state.speechStatus[playerId] = 'spoken';
  state.dayMessages.push({
    playerId,
    nickname: player.nickname,
    content: text,
    timestamp: Date.now(),
  });
  logEvent(state, 'player_action', `${player.nickname} 发言：${text}`, playerId);
}

/** 跳过发言 */
export function applyDaySkip(state: GameState, playerId: string): void {
  const player = findPlayer(state, playerId);
  if (state.phase !== 'day') throw new GameError('not_day', '当前不是白天发言阶段');
  if (!player.isAlive) throw new GameError('player_dead', '你已出局');
  if (state.speechStatus[playerId]) throw new GameError('already_spoken', '本轮已发言');

  state.speechStatus[playerId] = 'skipped';
  logEvent(state, 'player_action', `${player.nickname} 选择保持沉默`, playerId);
}

/** 猎人开枪（targetId 为空则放弃） */
export function applyHunterShoot(state: GameState, hunterId: string, targetId?: string): void {
  if (state.pendingHunter !== hunterId) throw new GameError('not_pending_hunter', '现在不能开枪');
  const hunter = findPlayer(state, hunterId);
  state.pendingHunter = undefined;

  if (!targetId) {
    logEvent(state, 'player_action', `${hunter.nickname} 收起了枪，选择不开枪`, hunterId);
    return;
  }
  const target = findPlayer(state, targetId);
  if (!target.isAlive) throw new GameError('target_dead', '目标已出局');
  if (targetId === hunterId) throw new GameError('cannot_shoot_self', '不能开枪打自己');

  target.isAlive = false;
  state.deadToday.push(targetId);
  logEvent(state, 'player_death', `${hunter.nickname} 开枪带走了 ${target.nickname}！`, hunterId, targetId);
  // 连锁：被枪带走的猎人也能开枪
  if (target.role === 'hunter') state.pendingHunter = targetId;
  checkGameEnd(state);
}

// ===== 投票 =====

/** 发言结束 → 进入投票阶段 */
export function startVotePhase(state: GameState): void {
  if (state.phase !== 'day') throw new GameError('not_day', '当前不是白天发言阶段');
  if (state.pendingHunter) throw new GameError('hunter_pending', '等待猎人开枪');
  state.phase = 'vote';
  state.votes = {};
  state.voteStatus = {};
  logEvent(state, 'phase_change', '发言结束，进入投票阶段');
}

export function applyVote(state: GameState, playerId: string, targetId: string | null): void {
  const player = findPlayer(state, playerId);
  if (state.phase !== 'vote') throw new GameError('not_vote_phase', '当前不是投票阶段');
  if (!player.isAlive) throw new GameError('player_dead', '你已出局');
  if (state.voteStatus[playerId]) throw new GameError('already_voted', '本轮已投票');

  if (targetId === null) {
    state.voteStatus[playerId] = 'abstained';
    logEvent(state, 'player_action', `${player.nickname} 弃票`, playerId);
    return;
  }
  const target = findPlayer(state, targetId);
  if (!target.isAlive) throw new GameError('target_dead', '目标已出局');
  if (targetId === playerId) throw new GameError('cannot_vote_self', '不能投票给自己');

  state.voteStatus[playerId] = 'voted';
  state.votes[playerId] = targetId;
}

/** 结算投票 → 出局 → 进入夜晚 */
export function resolveVote(state: GameState): void {
  if (state.phase !== 'vote') throw new GameError('not_vote_phase', '当前不是投票阶段');

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

  if (voteSummary) logEvent(state, 'player_action', `投票详情：${voteSummary}`);

  if (tie || !eliminated || maxVotes === 0) {
    logEvent(state, 'vote_result', '平票，本轮无人被放逐');
  } else {
    const target = state.players.find((p) => p.playerId === eliminated);
    if (target) {
      target.isAlive = false;
      state.deadToday.push(eliminated);
      logEvent(state, 'vote_result', `${target.nickname} 以 ${maxVotes} 票被放逐出局`, undefined, eliminated);
      if (target.role === 'hunter') state.pendingHunter = eliminated;
    }
  }

  checkGameEnd(state);
  if (state.winner) return;

  // 进入夜晚
  state.phase = 'night';
  state.round += 1;
  state.speechStatus = {};
  state.dayMessages = [];
  state.votes = {};
  state.voteStatus = {};
  state.deadTonight = [];
  state.deadToday = [];
  logEvent(state, 'phase_change', `第 ${state.round} 夜 天黑请闭眼`);
}

/** 检查游戏是否结束 */
export function checkGameEnd(state: GameState): void {
  const winner = checkVictory(state);
  if (winner) {
    state.phase = 'finished';
    state.winner = winner;
    state.pendingHunter = undefined;
    logEvent(state, 'game_end', winner === 'werewolf' ? '狼人阵营获胜！' : '好人阵营获胜！');
  }
}

// ===== 临终遗言 =====

/** 玩家发表临终遗言（仅 final_speech 阶段，刚死亡的玩家） */
export function applyFinalSpeech(state: GameState, playerId: string, content: string): void {
  const player = findPlayer(state, playerId);
  if (state.phase !== 'final_speech') throw new GameError('not_final_speech', '当前不是临终遗言阶段');
  if (player.isAlive) throw new GameError('player_alive', '只有出局玩家可以发表临终遗言');
  if (!state.deadTonight.includes(playerId) && !state.deadToday.includes(playerId)) {
    throw new GameError('not_dead_this_round', '只有本轮出局玩家可以发表临终遗言');
  }
  if (state.finalSpeechStatus[playerId]) throw new GameError('already_spoken', '已发表过临终遗言');

  const text = content.trim().slice(0, 200);
  if (!text) throw new GameError('empty_speech', '遗言不能为空');

  state.finalSpeechStatus[playerId] = 'spoken';
  state.finalSpeeches[playerId] = text;
  logEvent(state, 'final_speech', `${player.nickname} 的临终遗言：${text}`, playerId);
}

/** 跳过临终遗言 */
export function applyFinalSpeechSkip(state: GameState, playerId: string): void {
  const player = findPlayer(state, playerId);
  if (state.phase !== 'final_speech') throw new GameError('not_final_speech', '当前不是临终遗言阶段');
  if (player.isAlive) throw new GameError('player_alive', '只有出局玩家可以发表临终遗言');
  if (!state.deadTonight.includes(playerId) && !state.deadToday.includes(playerId)) {
    throw new GameError('not_dead_this_round', '只有本轮出局玩家可以发表临终遗言');
  }
  if (state.finalSpeechStatus[playerId]) throw new GameError('already_spoken', '已发表过临终遗言');

  state.finalSpeechStatus[playerId] = 'skipped';
  logEvent(state, 'final_speech', `${player.nickname} 选择不说遗言`, playerId);
}

/** 临终遗言阶段结束 → 进入白天 */
export function resolveFinalSpeech(state: GameState): void {
  if (state.phase !== 'final_speech') throw new GameError('not_final_speech', '当前不是临终遗言阶段');

  // 所有本轮死亡玩家都已发言或跳过
  const deadThisRound = [...state.deadTonight, ...state.deadToday];
  const allDone = deadThisRound.every((id) => state.finalSpeechStatus[id]);
  if (!allDone) throw new GameError('not_all_spoken', '还有死亡玩家未发表遗言');

  enterDayPhase(state);
}

// ===== 法官 =====

/** 法官发言（维持秩序） */
export function applyJudgeSpeak(state: GameState, judgeId: string, content: string): void {
  if (state.judgePlayerId !== judgeId) throw new GameError('not_judge', '你不是法官');
  const text = content.trim().slice(0, 200);
  if (!text) throw new GameError('empty_speech', '发言不能为空');
  const judge = state.players.find((p) => p.playerId === judgeId);
  logEvent(state, 'judge_speak', `法官：${text}`, judgeId, undefined);
  void judge;
}

/** AI 法官发号施令：根据当前阶段生成广播词（天黑请闭眼、天亮请睁眼等） */
export function aiJudgeBroadcast(state: GameState): string | null {
  switch (state.phase) {
    case 'night':
      return state.round === 1 ? '天黑请闭眼。狼人请睁眼并选择击杀目标。' : `第 ${state.round} 夜，天黑请闭眼。狼人请选择击杀目标。`;
    case 'final_speech':
      return '天亮了。请出局的玩家发表临终遗言。';
    case 'day': {
      const aliveCount = state.players.filter((p) => p.isAlive).length;
      return `天亮了，请睁眼。本局还剩 ${aliveCount} 名玩家，请依次发言。`;
    }
    case 'vote':
      return '发言结束，请开始投票放逐嫌疑人。';
    case 'finished':
      return state.winner === 'werewolf' ? '游戏结束，狼人阵营获胜！' : '游戏结束，好人阵营获胜！';
    default:
      return null;
  }
}

/** 法官视角：全量公开（所有身份、所有事件含角色、女巫药剂、预言家查验等） */
export function getJudgeView(state: GameState): Record<string, unknown> {
  return {
    format: state.format,
    phase: state.phase,
    round: state.round,
    game: 'werewolf',
    isJudge: true,
    judgeMode: state.judgeMode,
    judgePlayerId: state.judgePlayerId,
    players: state.players.map((p) => ({
      playerId: p.playerId,
      nickname: p.nickname,
      isAlive: p.isAlive,
      role: p.role,
      isMe: false,
    })),
    myRole: null,
    speechStatus: state.speechStatus,
    dayMessages: state.dayMessages,
    voteStatus: state.voteStatus,
    votes: state.votes,
    deadTonight: state.deadTonight,
    deadToday: state.deadToday,
    finalSpeeches: state.finalSpeeches,
    finalSpeechStatus: state.finalSpeechStatus,
    winner: state.winner,
    pendingHunter: state.pendingHunter,
    wolfVotes: state.wolfVotes,
    seerChecks: state.seerChecks,
    witchPotions: state.witchPotions,
    witchTonight: state.witchTonight,
    witchPoisonTarget: state.witchPoisonTarget,
    nightVictim: state.nightVictim,
    events: state.events,
  };
}

/** 玩家视角（隐藏他人身份；结束时全量公开）；isJudge=true 时返回法官全量视角 */
export function getPlayerView(state: GameState, playerId: string | null, isJudge = false) {
  if (isJudge) return getJudgeView(state);
  const me = playerId ? state.players.find((p) => p.playerId === playerId) : undefined;
  const finished = state.phase === 'finished';

  const view: Record<string, unknown> = {
    format: state.format,
    phase: state.phase,
    round: state.round,
    game: 'werewolf',
    players: state.players.map((p) => ({
      playerId: p.playerId,
      nickname: p.nickname,
      isAlive: p.isAlive,
      role: finished ? p.role : p.playerId === playerId ? p.role : undefined,
      isMe: p.playerId === playerId,
    })),
    myRole: me?.role,
    speechStatus: state.speechStatus,
    dayMessages: state.dayMessages,
    voteStatus: state.voteStatus,
    votes: state.phase === 'vote' ? {} : state.votes,
    deadTonight: state.deadTonight,
    deadToday: state.deadToday,
    winner: state.winner,
    pendingHunterIsMe: state.pendingHunter !== undefined && state.pendingHunter === playerId,
    // 事件里剥离角色信息（防止前端直接从 events 反推身份）
    events: state.events.map((e) => ({ ...e, role: undefined })),
  };

  if (me?.role === 'werewolf' && !finished) {
    view.wolfTeammates = state.players
      .filter((p) => p.role === 'werewolf' && p.playerId !== playerId)
      .map((p) => ({ playerId: p.playerId, nickname: p.nickname, isAlive: p.isAlive }));
  }
  if (me?.role === 'seer') {
    view.seerChecks = state.seerChecks;
  }
  if (me?.role === 'witch') {
    view.witchPotions = state.witchPotions;
    view.witchActed = Boolean(state.witchTonight);
    if (state.phase === 'night' && !state.witchTonight) {
      view.nightVictim = state.nightVictim
        ? state.players.find((p) => p.playerId === state.nightVictim)?.nickname
        : null;
    }
  }
  if (me?.role === 'hunter' && !finished) {
    view.canShoot = state.pendingHunter === playerId;
  }
  // 我的夜晚行动是否已完成（前端据此渲染行动面板）
  if (me && state.phase === 'night' && !finished) {
    view.myNightActionDone =
      me.role === 'werewolf'
        ? Boolean(playerId && state.wolfVotes[playerId])
        : me.role === 'seer'
          ? state.seerCheckedTonight.length > 0
          : me.role === 'witch'
            ? state.witchTonight !== undefined
            : true;
  }
  return view;
}
