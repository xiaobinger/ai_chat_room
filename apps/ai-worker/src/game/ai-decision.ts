import type { GameState, GameAction, PlayerState } from './types';

/** AI 玩家决策上下文 */
interface DecisionContext {
  state: GameState;
  aiPlayer: PlayerState;
  alivePlayers: PlayerState[];
}

/** 生成 AI 夜晚行动 */
export function decideNightAction(ctx: DecisionContext): GameAction | null {
  const { aiPlayer } = ctx;

  switch (aiPlayer.role) {
    case 'werewolf':
      return decideWerewolfAction(ctx);
    case 'seer':
      return decideSeerAction(ctx);
    case 'witch':
      return decideWitchAction(ctx);
    default:
      return null;
  }
}

/** 狼人行动：选择一个非狼人玩家杀死 */
function decideWerewolfAction(ctx: DecisionContext): GameAction | null {
  const { aiPlayer, alivePlayers } = ctx;

  // 可杀目标：非狼人且存活
  const targets = alivePlayers.filter((p) => p.role !== 'werewolf' && p.playerId !== aiPlayer.playerId);
  if (targets.length === 0) return null;

  // 优先杀有特殊能力的玩家（预言家、女巫、猎人）
  const priorityTargets = targets.filter((p) => p.role === 'seer' || p.role === 'witch' || p.role === 'hunter');
  const candidateTargets = priorityTargets.length > 0 ? priorityTargets : targets;

  // 随机选择一个目标
  const target = candidateTargets[Math.floor(Math.random() * candidateTargets.length)];

  return {
    type: 'werewolf_kill',
    playerId: aiPlayer.playerId,
    targetId: target.playerId,
  };
}

/** 预言家行动：选择一个未查验过的玩家查验 */
function decideSeerAction(ctx: DecisionContext): GameAction | null {
  const { aiPlayer, alivePlayers, state } = ctx;

  // 可查验目标：存活且不是自己，且未查验过
  const checkedTargets = state.seerResult ? [state.seerResult.target] : [];
  const targets = alivePlayers.filter(
    (p) => p.playerId !== aiPlayer.playerId && !checkedTargets.includes(p.playerId),
  );
  if (targets.length === 0) return null;

  // 随机选择一个目标
  const target = targets[Math.floor(Math.random() * targets.length)];

  return {
    type: 'seer_check',
    playerId: aiPlayer.playerId,
    targetId: target.playerId,
  };
}

/** 女巫行动：决定是否使用药水 */
function decideWitchAction(ctx: DecisionContext): GameAction | null {
  const { aiPlayer, alivePlayers, state } = ctx;

  // 如果狼人杀了人且女巫有解药，50% 概率救人
  if (state.werewolfTarget && !state.witchAction?.type) {
    const target = alivePlayers.find((p) => p.playerId === state.werewolfTarget);
    if (target && Math.random() < 0.5) {
      return {
        type: 'witch_save',
        playerId: aiPlayer.playerId,
        targetId: state.werewolfTarget,
      };
    }
  }

  // 如果女巫有毒药，20% 概率毒人
  if (state.witchAction?.type !== 'poison' && Math.random() < 0.2) {
    const targets = alivePlayers.filter((p) => p.playerId !== aiPlayer.playerId);
    if (targets.length > 0) {
      const target = targets[Math.floor(Math.random() * targets.length)];
      return {
        type: 'witch_poison',
        playerId: aiPlayer.playerId,
        targetId: target.playerId,
      };
    }
  }

  return null;
}

/** 生成 AI 白天发言 */
export function generateDaySpeech(ctx: DecisionContext): GameAction {
  const { aiPlayer } = ctx;

  const messages = generateSpeechContent(ctx);

  return {
    type: 'day_speak',
    playerId: aiPlayer.playerId,
    content: messages,
  };
}

/** 生成发言内容 */
function generateSpeechContent(ctx: DecisionContext): string {
  const { aiPlayer, state } = ctx;

  const myRole = aiPlayer.role;
  const deadTonight = state.deadTonight;

  // 根据角色生成不同风格的发言
  if (myRole === 'werewolf') {
    // 狼人：伪装成村民，误导其他人
    const templates = [
      `大家好，我是村民。昨晚死了 ${deadTonight.length > 0 ? '人' : '没有人'}，我们要小心。`,
      `我觉得我们应该集中票数，不要分散。`,
      `我观察了一下，有些人发言不太对劲，大家注意一下。`,
      `我们是村民阵营，一定要团结，把狼人找出来。`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  if (myRole === 'seer') {
    // 预言家：可能跳出来带队
    if (state.seerResult) {
      const target = state.players.find((p) => p.playerId === state.seerResult?.target);
      if (target) {
        const isWolf = state.seerResult.isWerewolf;
        if (isWolf && Math.random() < 0.6) {
          return `我是预言家，昨晚查验了 ${target.nickname}，是狼人！大家投他！`;
        } else if (!isWolf && Math.random() < 0.3) {
          return `我是预言家，昨晚查验了 ${target.nickname}，是好人。`;
        }
      }
    }
    return `我是村民，大家听我分析。`;
  }

  if (myRole === 'witch') {
    // 女巫：通常隐藏身份
    const templates = [
      `我是村民，大家不要被误导了。`,
      `我觉得我们应该先听每个人发言再决定。`,
      `昨晚的事很蹊跷，大家小心投票。`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  if (myRole === 'hunter') {
    // 猎人：可能暗示身份
    const templates = [
      `我是村民，但我有自保能力，狼人别轻易动我。`,
      `大家听我说，我们要理性分析。`,
      `我建议先投发言最可疑的人。`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // 村民
  const templates = [
    `我是村民，大家要好好投票。`,
    `我觉得我们要团结，不要被狼人带节奏。`,
    `昨晚死了人，我们要找出狼人。`,
    `大家发言要注意逻辑，狼人会露馅的。`,
    `我支持票数最多的人出局。`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

/** 生成 AI 投票 */
export function decideVote(ctx: DecisionContext): GameAction {
  const { aiPlayer, alivePlayers, state } = ctx;

  // 可投票目标：存活且不是自己
  const targets = alivePlayers.filter((p) => p.playerId !== aiPlayer.playerId);

  if (targets.length === 0) {
    return { type: 'vote', playerId: aiPlayer.playerId };
  }

  // 根据角色选择投票策略
  let target: PlayerState;

  if (aiPlayer.role === 'werewolf') {
    // 狼人：投非狼人玩家，优先投神职
    const villagers = targets.filter((p) => p.role !== 'werewolf');
    const gods = villagers.filter((p) => p.role === 'seer' || p.role === 'witch' || p.role === 'hunter');
    const candidateTargets = gods.length > 0 ? gods : villagers;
    target = candidateTargets[Math.floor(Math.random() * candidateTargets.length)] ?? targets[0];
  } else if (aiPlayer.role === 'seer' && state.seerResult?.isWerewolf) {
    // 预言家：如果查到狼人，投狼人
    const wolf = targets.find((p) => p.playerId === state.seerResult?.target);
    target = wolf ?? targets[Math.floor(Math.random() * targets.length)];
  } else {
    // 其他：随机投
    target = targets[Math.floor(Math.random() * targets.length)];
  }

  return {
    type: 'vote',
    playerId: aiPlayer.playerId,
    targetId: target.playerId,
  };
}
