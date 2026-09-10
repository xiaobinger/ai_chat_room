import type { GameState, PlayerState } from './types';

/** AI 玩家决策上下文 */
interface DecisionContext {
  state: GameState;
  aiPlayer: PlayerState;
}

const pick = <T>(list: T[]): T | undefined =>
  list.length > 0 ? list[Math.floor(Math.random() * list.length)] : undefined;

/** 是否有人声称自己是预言家（按发言文本粗判，狼人刀人/投票参考） */
function claimedSeer(state: GameState): PlayerState | undefined {
  for (const message of state.dayMessages) {
    if (message.content.includes('预言家')) {
      return state.players.find((p) => p.playerId === message.playerId && p.isAlive);
    }
  }
  return undefined;
}

function claimedSeers(state: GameState): PlayerState[] {
  const ids = new Set<string>();
  for (const message of state.dayMessages) {
    if (message.content.includes('预言家')) ids.add(message.playerId);
  }
  return state.players.filter((player) => player.isAlive && ids.has(player.playerId));
}

function countPublicPressure(state: GameState, player: PlayerState): number {
  const keywords = ['狼人', '可疑', '查杀', '投', '怀疑', '不像好人'];
  let mentions = 0;
  for (const message of state.dayMessages) {
    if (message.playerId === player.playerId) continue;
    if (!message.content.includes(player.nickname)) continue;
    if (keywords.some((keyword) => message.content.includes(keyword))) mentions += 1;
  }
  return mentions;
}

function publicScore(state: GameState, player: PlayerState): number {
  const seerClaimBonus = claimedSeers(state).some((candidate) => candidate.playerId === player.playerId) ? 4 : 0;
  return player.suspicion * 3 + countPublicPressure(state, player) * 2 + seerClaimBonus;
}

function bestPublicTarget(
  state: GameState,
  candidates: PlayerState[],
  options?: { preferLowSuspicion?: boolean },
): PlayerState | undefined {
  if (candidates.length === 0) return undefined;
  const sorted = [...candidates].sort((a, b) => {
    const scoreDiff = publicScore(state, b) - publicScore(state, a);
    if (scoreDiff !== 0) return scoreDiff;
    if (options?.preferLowSuspicion) return a.suspicion - b.suspicion;
    return b.suspicion - a.suspicion;
  });
  return sorted[0];
}

function aliveNonWolves(state: GameState): PlayerState[] {
  return state.players.filter((player) => player.isAlive && player.role !== 'werewolf');
}

function summarizeNight(state: GameState): string {
  if (state.deadTonight.length === 0) return '昨晚是平安夜';
  const names = state.deadTonight
    .map((id) => state.players.find((player) => player.playerId === id)?.nickname)
    .filter(Boolean)
    .join('、');
  return `昨晚倒下的是 ${names}`;
}

// ===== 夜晚 =====

/** 狼人：优先刀跳预言家的人，否则随机（不偷看身份） */
export function decideWolfKill(ctx: DecisionContext): string | undefined {
  const { state } = ctx;
  const targets = aliveNonWolves(state);
  if (targets.length === 0) return undefined;

  const seerClaimants = claimedSeers(state).filter((player) => player.role !== 'werewolf');
  const primary = bestPublicTarget(state, seerClaimants);
  if (primary && Math.random() < 0.8) return primary.playerId;

  const influential = bestPublicTarget(
    state,
    targets.filter((player) => player.suspicion <= 2),
    { preferLowSuspicion: true },
  );
  return influential?.playerId ?? pick(targets)?.playerId;
}

/** 预言家：优先查跳预言家或高嫌疑目标，其次随机 */
export function decideSeerCheck(ctx: DecisionContext): string | undefined {
  const { state, aiPlayer } = ctx;
  const checked = new Set(state.seerChecks.map((c) => c.target));
  const targets = state.players.filter(
    (p) => p.isAlive && p.playerId !== aiPlayer.playerId && !checked.has(p.playerId),
  );
  const seerClaimants = claimedSeers(state).filter((player) => player.playerId !== aiPlayer.playerId && !checked.has(player.playerId));
  const claimantTarget = bestPublicTarget(state, seerClaimants);
  if (claimantTarget) return claimantTarget.playerId;

  const suspicious = bestPublicTarget(state, targets.filter((player) => player.suspicion > 0));
  return suspicious?.playerId ?? pick(targets)?.playerId;
}

/** 女巫：优先救自己/疑似关键好人；多人跳预言家或高嫌疑时更倾向下毒 */
export function decideWitchAction(ctx: DecisionContext): 'save' | 'poison' | 'pass' {
  const { state, aiPlayer } = ctx;
  const victim = state.nightVictim ? state.players.find((player) => player.playerId === state.nightVictim) : undefined;
  const seerClaimants = claimedSeers(state);

  if (victim && state.witchPotions.save) {
    if (victim.playerId === aiPlayer.playerId) return 'save';
    if (seerClaimants.some((player) => player.playerId === victim.playerId)) return 'save';
    if (victim.suspicion <= 1 && Math.random() < 0.8) return 'save';
    if (Math.random() < 0.45) return 'save';
  }
  if (state.witchPotions.poison) {
    const poisonTarget = decideWitchPoisonTarget(ctx);
    const publicClaimantChaos = seerClaimants.length >= 2;
    const highlySuspicious = poisonTarget
      ? state.players.find((player) => player.playerId === poisonTarget)?.suspicion ?? 0
      : 0;
    if (poisonTarget && (publicClaimantChaos || highlySuspicious >= 2) && Math.random() < 0.35) {
      return 'poison';
    }
  }
  return 'pass';
}

export function decideWitchPoisonTarget(ctx: DecisionContext): string | undefined {
  const { state, aiPlayer } = ctx;
  const targets = state.players.filter((p) => p.isAlive && p.playerId !== aiPlayer.playerId);
  const claimants = claimedSeers(state).filter((player) => player.playerId !== aiPlayer.playerId);
  if (claimants.length >= 2) {
    return bestPublicTarget(state, claimants)?.playerId;
  }
  return bestPublicTarget(state, targets)?.playerId ?? pick(targets)?.playerId;
}

// ===== 白天 =====

export function generateDaySpeech(ctx: DecisionContext): string {
  const { state, aiPlayer } = ctx;
  const nightSummary = summarizeNight(state);
  const seerClaimants = claimedSeers(state);
  const topSuspect = bestPublicTarget(
    state,
    state.players.filter((player) => player.isAlive && player.playerId !== aiPlayer.playerId),
  );

  if (aiPlayer.role === 'werewolf') {
    const pressureTarget =
      bestPublicTarget(state, seerClaimants.filter((player) => player.playerId !== aiPlayer.playerId)) ?? topSuspect;
    const templates = [
      `${nightSummary}，我更想听听 ${pressureTarget?.nickname ?? '那几个带节奏的人'} 怎么解释自己的逻辑。`,
      `我先站好人视角，今天别乱分票，${pressureTarget ? `我更怀疑 ${pressureTarget.nickname}` : '优先处理发言最飘的人'}。`,
      `场上有人发言太像提前做身份铺垫了，${pressureTarget ? `${pressureTarget.nickname} 得多聊两句。` : '大家别轻易信第一个带队的人。'}`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  if (aiPlayer.role === 'seer') {
    const last = state.seerChecks[state.seerChecks.length - 1];
    if (last && state.round >= 1) {
      const target = state.players.find((p) => p.playerId === last.target);
      if (target) {
        if (last.isWerewolf) {
          return `我是预言家，${nightSummary}。我昨晚查验了 ${target.nickname}，结果是狼人，今天先把票挂在他身上。`;
        }
        if (!last.isWerewolf) {
          return `我是预言家，昨晚查验了 ${target.nickname}，他是好人。今天别把票浪费在 ${target.nickname} 身上。`;
        }
      }
    }
    return `我是预言家，信息还不够多，今天先看谁的发言最像悍跳和冲票。`;
  }

  if (aiPlayer.role === 'witch') {
    const pressureTarget = bestPublicTarget(state, seerClaimants.length >= 2 ? seerClaimants : topSuspect ? [topSuspect] : []);
    const templates = [
      `${nightSummary}，我建议大家先把逻辑对齐，再决定今天出谁。`,
      `${pressureTarget ? `我现在更想听 ${pressureTarget.nickname} 的解释。` : '我先不急着站边，想再听一轮发言。'} `,
      `今天的票型很关键，谁要带队就把理由讲完整，别只丢一句“像狼”。`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  if (aiPlayer.role === 'hunter') {
    const pressureTarget = topSuspect?.nickname ?? '最可疑的人';
    const templates = [
      `${nightSummary}，别急着冲票，先把 ${pressureTarget} 的发言摊开讲明白。`,
      `我偏好先出发言最虚、最想糊弄过去的人，这轮不要被情绪带着走。`,
      `我站好人视角说一句，今天谁逻辑断层最大，谁就应该先上轮次。`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  const pressureTarget = topSuspect?.nickname ?? '最可疑的人';
  const templates = [
    `${nightSummary}，我是村民，今天先盯 ${pressureTarget} 这类发言最别扭的人。`,
    `大家别慌，谁前后说法变得最快，谁就值得多怀疑。`,
    `我赞成集中票型，但前提是先把理由说透，别盲跟。`,
    `狼人最爱混在“随便投一个”里，好人今天尽量把票型收紧。`,
    `${seerClaimants.length >= 2 ? '场上预言家对跳了，我建议重点听两边的逻辑和视角差异。' : '信息量还不够，先抓发言矛盾最大的。'} `,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

export function decideVote(ctx: DecisionContext): { targetId: string | null } {
  const { state, aiPlayer } = ctx;
  const targets = state.players.filter((p) => p.isAlive && p.playerId !== aiPlayer.playerId);
  if (targets.length === 0) return { targetId: null };
  const seerClaimants = claimedSeers(state).filter((player) => player.playerId !== aiPlayer.playerId);

  if (aiPlayer.role === 'werewolf') {
    // 狼人：优先冲掉带队的预言家或高影响力好人
    const nonWolves = targets.filter((p) => p.role !== 'werewolf');
    if (nonWolves.length === 0) return { targetId: null };
    const claimant = bestPublicTarget(state, seerClaimants.filter((player) => player.role !== 'werewolf'));
    if (claimant) return { targetId: claimant.playerId };
    return { targetId: (bestPublicTarget(state, nonWolves) ?? pick(nonWolves))?.playerId ?? null };
  }

  if (aiPlayer.role === 'seer') {
    // 预言家：优先投最近查杀的狼
    const knownWolf = [...state.seerChecks]
      .reverse()
      .find((c) => c.isWerewolf && state.players.find((p) => p.playerId === c.target)?.isAlive);
    if (knownWolf) return { targetId: knownWolf.target };
  }

  // 好人：预言家对跳时优先投对跳位，否则按公开压力与嫌疑投票
  if (seerClaimants.length >= 2) {
    const claimant = bestPublicTarget(state, seerClaimants);
    if (claimant) return { targetId: claimant.playerId };
  }
  const publicTarget = bestPublicTarget(state, targets);
  if (publicTarget && publicScore(state, publicTarget) > 0) return { targetId: publicTarget.playerId };
  if (Math.random() < 0.1) return { targetId: null };
  return { targetId: (publicTarget ?? pick(targets))?.playerId ?? null };
}

/** 猎人开枪：AI 优先带走跳过预言家查杀的人，否则不开枪 */
export function decideHunterShoot(ctx: DecisionContext): string | undefined {
  const { state } = ctx;
  const targets = state.players.filter((p) => p.isAlive);
  const claimed = claimedSeer(state);
  if (claimed && Math.random() < 0.5) return claimed.playerId;
  const anyTarget = pick(targets);
  return anyTarget && Math.random() < 0.6 ? anyTarget.playerId : undefined;
}
