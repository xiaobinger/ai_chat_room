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

// ===== 夜晚 =====

/** 狼人：优先刀跳预言家的人，否则随机（不偷看身份） */
export function decideWolfKill(ctx: DecisionContext): string | undefined {
  const { state } = ctx;
  const targets = state.players.filter((p) => p.isAlive && p.role !== 'werewolf');
  if (targets.length === 0) return undefined;

  const claimant = claimedSeer(state);
  if (claimant && Math.random() < 0.7) return claimant.playerId;
  return pick(targets)?.playerId;
}

/** 预言家：随机查验一个未查过的人 */
export function decideSeerCheck(ctx: DecisionContext): string | undefined {
  const { state, aiPlayer } = ctx;
  const checked = new Set(state.seerChecks.map((c) => c.target));
  const targets = state.players.filter(
    (p) => p.isAlive && p.playerId !== aiPlayer.playerId && !checked.has(p.playerId),
  );
  return pick(targets)?.playerId;
}

/** 女巫：65% 救刀口，20% 毒嫌疑最高的人 */
export function decideWitchAction(ctx: DecisionContext): 'save' | 'poison' | 'pass' {
  const { state, aiPlayer } = ctx;
  if (state.nightVictim && state.witchPotions.save && Math.random() < 0.65) return 'save';
  if (state.witchPotions.poison && Math.random() < 0.2) {
    const targets = state.players.filter((p) => p.isAlive && p.playerId !== aiPlayer.playerId);
    if (targets.length > 0) return 'poison';
  }
  return 'pass';
}

export function decideWitchPoisonTarget(ctx: DecisionContext): string | undefined {
  const { state, aiPlayer } = ctx;
  const targets = state.players.filter((p) => p.isAlive && p.playerId !== aiPlayer.playerId);
  const sorted = [...targets].sort((a, b) => b.suspicion - a.suspicion);
  return (sorted[0] ?? pick(targets))?.playerId;
}

// ===== 白天 =====

export function generateDaySpeech(ctx: DecisionContext): string {
  const { state, aiPlayer } = ctx;
  const deadCount = state.deadTonight.length;

  if (aiPlayer.role === 'werewolf') {
    const templates = [
      `我是个普通村民。昨晚${deadCount > 0 ? '倒下了一位同伴' : '是平安夜'}，大家要谨慎。`,
      `我觉得票不要分散，跟着发言最有逻辑的人走。`,
      `有人发言在避重就轻，大家留意一下。`,
      `好人要团结，别被带节奏。`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  if (aiPlayer.role === 'seer') {
    const last = state.seerChecks[state.seerChecks.length - 1];
    if (last && state.round >= 1) {
      const target = state.players.find((p) => p.playerId === last.target);
      if (target) {
        if (last.isWerewolf && Math.random() < 0.7) {
          return `我是预言家，昨晚查验了 ${target.nickname}，查杀！建议大家投他。`;
        }
        if (!last.isWerewolf && Math.random() < 0.4) {
          return `我是预言家，昨晚查验了 ${target.nickname}，是好人，可以信任。`;
        }
      }
    }
    return `我是好人，听我分析场上局势。`;
  }

  if (aiPlayer.role === 'witch') {
    const templates = [
      `我身份比较普通，先听听大家的发言。`,
      `昨晚的情况有些意外，投票前想再多听一轮。`,
      `建议大家把怀疑的理由说清楚再投。`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  if (aiPlayer.role === 'hunter') {
    const templates = [
      `我是好人，而且我有自保手段，狼人动手前想清楚。`,
      `别急着投票，先把逻辑理顺。`,
      `我建议先处理发言最可疑的人。`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  const templates = [
    `我是村民，今晚好好投一票。`,
    `大家别慌，按发言质量来判断。`,
    `昨晚的信息量有限，这轮要仔细听。`,
    `狼人会伪装，注意前后矛盾的人。`,
    `我同意集中票型的思路。`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

export function decideVote(ctx: DecisionContext): { targetId: string | null } {
  const { state, aiPlayer } = ctx;
  const targets = state.players.filter((p) => p.isAlive && p.playerId !== aiPlayer.playerId);
  if (targets.length === 0) return { targetId: null };

  if (aiPlayer.role === 'werewolf') {
    // 狼人：跟票场上嫌疑最高的好人，避免投同伴
    const nonWolves = targets.filter((p) => p.role !== 'werewolf');
    if (nonWolves.length === 0) return { targetId: null };
    const sorted = [...nonWolves].sort((a, b) => b.suspicion - a.suspicion);
    return { targetId: (sorted[0] ?? pick(nonWolves)).playerId };
  }

  if (aiPlayer.role === 'seer') {
    // 预言家：优先投最近查杀的狼
    const knownWolf = [...state.seerChecks]
      .reverse()
      .find((c) => c.isWerewolf && state.players.find((p) => p.playerId === c.target)?.isAlive);
    if (knownWolf) return { targetId: knownWolf.target };
  }

  // 好人：按嫌疑投票，零嫌疑时小概率弃票
  const sorted = [...targets].sort((a, b) => b.suspicion - a.suspicion);
  if (sorted[0] && sorted[0].suspicion > 0) return { targetId: sorted[0].playerId };
  if (Math.random() < 0.1) return { targetId: null };
  return { targetId: (sorted[0] ?? pick(targets)).playerId };
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
