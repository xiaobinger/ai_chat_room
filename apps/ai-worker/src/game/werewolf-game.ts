import type { GameState, PlayerState } from './types';
import { ROLE_LABELS } from './types';
import { GameError, type EngineAction, type GamePlayerInfo } from './errors';
import { BaseGameEngine } from './base-engine';
import {
  initGameState,
  getAlivePlayers,
  applyWolfKill,
  applySeerCheck,
  applyWitchAction,
  applyDaySpeak,
  applyDaySkip,
  applyHunterShoot,
  applyVote,
  startVotePhase,
  resolveNight,
  resolveVote,
  getPlayerView,
  applyFinalSpeech,
  applyFinalSpeechSkip,
  resolveFinalSpeech,
  applyJudgeSpeak,
  aiJudgeBroadcast,
} from './werewolf-engine';
import {
  decideWolfKill,
  decideSeerCheck,
  decideWitchAction,
  decideWitchPoisonTarget,
  generateDaySpeech,
  decideVote,
  decideHunterShoot,
} from './ai-decision';

const NIGHT_DEADLINE_MS = 60_000;
const DAY_DEADLINE_MS = 90_000;
const VOTE_DEADLINE_MS = 45_000;
const HUNTER_DEADLINE_MS = 30_000;
const FINAL_SPEECH_DEADLINE_MS = 30_000;

const pick = <T>(list: T[]): T | undefined =>
  list.length > 0 ? list[Math.floor(Math.random() * list.length)] : undefined;

/** AI 法官临终遗言模板 */
function generateAiFinalSpeech(role: string, _nickname: string): string {
  const templates: Record<string, string[]> = {
    werewolf: [
      `我是狼人，没想到这么快就暴露了。大家小心好人被带节奏。`,
      `我承认是狼，但队友还在，你们赢不了的。`,
      `我走了，剩下的狼人替我报仇。`,
    ],
    villager: [
      `我是村民，被冤枉了！大家要相信我，别被狼人带偏。`,
      `我真的是好人，投我的都是狼人，记住他们的表情。`,
      `我冤啊，我是村民，大家一定要找出真正的狼人。`,
    ],
    seer: [
      `我是预言家！我查验过的人里，谁是狼人我清楚，听我的金水。`,
      `我是真预言家，我死了，大家要相信我之前查验的结果。`,
      `我是预言家，被狼人刀了，大家要团结好人。`,
    ],
    witch: [
      `我是女巫，我的药已经用完了。大家要靠发言找狼人。`,
      `我是女巫，我救过/毒过人，大家要相信我的判断。`,
      `我是女巫，我走了，剩下的好人要加油。`,
    ],
    hunter: [
      `我是猎人，我开枪带走我怀疑的人！`,
      `我是猎人，我死了也要拉一个垫背的。`,
      `我是猎人，我开枪了，带走那个最可疑的人。`,
    ],
  };
  const list = templates[role] ?? templates.villager;
  return list[Math.floor(Math.random() * list.length)];
}

/** 狼人杀引擎：驱动阶段机与 AI 行为 */
export class WerewolfGame extends BaseGameEngine {
  private state: GameState;
  private lastBroadcast: string | null = null;

  constructor(
    players: GamePlayerInfo[],
    state?: Record<string, unknown>,
    options?: { judgeMode?: 'owner' | 'ai' | null; judgePlayerId?: string | null },
  ) {
    super(players);
    if (state) {
      if (state.format !== 2) throw new GameError('unsupported_state', '旧版本游戏状态无法恢复');
      this.state = state as unknown as GameState;
    } else {
      this.state = initGameState(
        players.map((p) => ({ playerId: p.playerId, nickname: p.nickname })),
        options?.judgePlayerId,
      );
      this.state.judgeMode = options?.judgeMode ?? null;
      this.state.judgePlayerId = options?.judgePlayerId ?? null;
    }
  }

  getState(): Record<string, unknown> {
    return this.state as unknown as Record<string, unknown>;
  }

  isFinished(): boolean {
    return this.state.phase === 'finished';
  }

  getResults(): Record<string, { won: boolean; role: string }> | null {
    if (!this.state.winner) return null;
    const winner = this.state.winner;
    const results: Record<string, { won: boolean; role: string }> = {};
    for (const p of this.state.players) {
      results[p.playerId] = {
        won: p.role === 'werewolf' ? winner === 'werewolf' : winner === 'villager',
        role: ROLE_LABELS[p.role],
      };
    }
    return results;
  }

  getView(playerId: string | null, isJudge?: boolean): Record<string, unknown> {
    return getPlayerView(this.state, playerId, isJudge ?? false);
  }

  getRoles(): Record<string, string> {
    const roles: Record<string, string> = {};
    for (const p of this.state.players) roles[p.playerId] = ROLE_LABELS[p.role];
    return roles;
  }

  phaseDeadlineMs(): number {
    if (this.state.pendingHunter) return HUNTER_DEADLINE_MS;
    switch (this.state.phase) {
      case 'night':
        return NIGHT_DEADLINE_MS;
      case 'day':
        return DAY_DEADLINE_MS;
      case 'vote':
        return VOTE_DEADLINE_MS;
      case 'final_speech':
        return FINAL_SPEECH_DEADLINE_MS;
      default:
        return 0;
    }
  }

  /** 当前需要行动的人类玩家 */
  pendingHumans(): string[] {
    const state = this.state;
    if (state.phase === 'finished') return [];
    const alive = getAlivePlayers(state);

    if (state.pendingHunter) {
      return this.isAi(state.pendingHunter) || !alive.some((p) => p.playerId === state.pendingHunter)
        ? []
        : [state.pendingHunter];
    }

    const pending: string[] = [];
    if (state.phase === 'night') {
      for (const p of alive) {
        if (this.isAi(p.playerId)) continue;
        const acted =
          (p.role === 'werewolf' && state.wolfVotes[p.playerId]) ||
          (p.role === 'seer' && state.seerCheckedTonight.length > 0) ||
          (p.role === 'witch' && state.witchTonight !== undefined);
        if (!acted) pending.push(p.playerId);
      }
      return pending;
    }

    if (state.phase === 'final_speech') {
      const deadThisRound = [...state.deadTonight, ...state.deadToday];
      for (const id of deadThisRound) {
        if (state.finalSpeechStatus[id]) continue;
        if (this.isAi(id)) continue;
        pending.push(id);
      }
      return pending;
    }

    for (const p of alive) {
      if (this.isAi(p.playerId)) continue;
      if (state.phase === 'day' && !state.speechStatus[p.playerId]) pending.push(p.playerId);
      if (state.phase === 'vote' && !state.voteStatus[p.playerId]) pending.push(p.playerId);
    }
    return pending;
  }

  handleAction(action: EngineAction): void {
    switch (action.type) {
      case 'werewolf_kill':
        applyWolfKill(this.state, action.playerId, action.targetId ?? '');
        break;
      case 'seer_check':
        applySeerCheck(this.state, action.playerId, action.targetId ?? '');
        break;
      case 'witch_save':
        applyWitchAction(this.state, action.playerId, 'save');
        break;
      case 'witch_poison':
        applyWitchAction(this.state, action.playerId, 'poison', action.targetId);
        break;
      case 'witch_pass':
        applyWitchAction(this.state, action.playerId, 'pass');
        break;
      case 'day_speak':
        applyDaySpeak(this.state, action.playerId, action.content ?? '');
        break;
      case 'day_skip':
        applyDaySkip(this.state, action.playerId);
        break;
      case 'vote':
        applyVote(this.state, action.playerId, action.targetId ?? null);
        break;
      case 'vote_abstain':
        applyVote(this.state, action.playerId, null);
        break;
      case 'hunter_shoot':
        applyHunterShoot(this.state, action.playerId, action.targetId);
        break;
      case 'final_speech':
        applyFinalSpeech(this.state, action.playerId, action.content ?? '');
        break;
      case 'final_speech_skip':
        applyFinalSpeechSkip(this.state, action.playerId);
        break;
      case 'judge_speak':
        applyJudgeSpeak(this.state, action.playerId, action.content ?? '');
        break;
      default:
        throw new GameError('unknown_action', `未知动作：${action.type}`);
    }
  }

  /** 超时托管 */
  autoAct(playerId: string): void {
    const state = this.state;
    if (state.phase === 'finished') return;

    if (state.pendingHunter === playerId) {
      applyHunterShoot(this.state, playerId, undefined);
      return;
    }

    if (state.phase === 'final_speech') {
      const deadThisRound = [...state.deadTonight, ...state.deadToday];
      if (deadThisRound.includes(playerId) && !state.finalSpeechStatus[playerId]) {
        applyFinalSpeechSkip(state, playerId);
      }
      return;
    }

    const me = state.players.find((p) => p.playerId === playerId);
    if (!me || !me.isAlive) return;

    if (state.phase === 'night') {
      if (me.role === 'werewolf' && !state.wolfVotes[playerId]) {
        const target = pick(getAlivePlayers(state).filter((p) => p.role !== 'werewolf'));
        if (target) applyWolfKill(state, playerId, target.playerId);
      } else if (me.role === 'seer' && state.seerCheckedTonight.length === 0) {
        const target = pick(
          getAlivePlayers(state).filter((p) => p.playerId !== playerId),
        );
        if (target) {
          applySeerCheck(state, playerId, target.playerId);
        } else {
          state.seerCheckedTonight.push(playerId);
        }
      } else if (me.role === 'witch' && state.witchTonight === undefined) {
        applyWitchAction(state, playerId, 'pass');
      }
      return;
    }

    if (state.phase === 'day' && !state.speechStatus[playerId]) {
      applyDaySkip(state, playerId);
      return;
    }

    if (state.phase === 'vote' && !state.voteStatus[playerId]) {
      applyVote(state, playerId, null);
    }
  }

  /** 推进一原子步：AI 行动或阶段结算。返回 false 表示等待人类或已结束。 */
  step(): boolean {
    const state = this.state;
    if (state.phase === 'finished') return false;

    // AI 法官广播阶段指令
    if (state.judgeMode === 'ai' && state.judgePlayerId) {
      const broadcast = aiJudgeBroadcast(state);
      if (broadcast && !this.lastBroadcast) {
        applyJudgeSpeak(state, state.judgePlayerId, broadcast);
        this.lastBroadcast = broadcast;
        return true;
      }
      if (broadcast && this.lastBroadcast !== broadcast) {
        applyJudgeSpeak(state, state.judgePlayerId, broadcast);
        this.lastBroadcast = broadcast;
        return true;
      }
    }

    // 猎人开枪优先（白天任何时点）
    if (state.pendingHunter) {
      if (!this.isAi(state.pendingHunter)) return false;
      const hunterId = state.pendingHunter;
      const hunter = state.players.find((p) => p.playerId === hunterId);
      if (!hunter) {
        state.pendingHunter = undefined;
        return true;
      }
      const targetId = decideHunterShoot({ state, aiPlayer: hunter });
      applyHunterShoot(state, hunterId, targetId);
      return true;
    }

    switch (state.phase) {
      case 'night':
        return this.stepNight();
      case 'day':
        return this.stepDay();
      case 'vote':
        return this.stepVote();
      case 'final_speech':
        return this.stepFinalSpeech();
    }
    return false;
  }

  private stepNight(): boolean {
    const state = this.state;
    const alive = getAlivePlayers(state);

    for (const p of alive) {
      if (p.role === 'werewolf' && this.isAi(p.playerId) && !state.wolfVotes[p.playerId]) {
        const targetId = decideWolfKill({ state, aiPlayer: p });
        if (targetId) applyWolfKill(state, p.playerId, targetId);
        return true;
      }
    }

    const seer = alive.find((p) => p.role === 'seer');
    if (seer && this.isAi(seer.playerId) && state.seerCheckedTonight.length === 0) {
      const targetId = decideSeerCheck({ state, aiPlayer: seer });
      if (targetId) {
        applySeerCheck(state, seer.playerId, targetId);
      } else {
        state.seerCheckedTonight.push(seer.playerId);
      }
      return true;
    }

    const witch = alive.find((p) => p.role === 'witch');
    if (witch && this.isAi(witch.playerId) && state.witchTonight === undefined) {
      const decision = decideWitchAction({ state, aiPlayer: witch });
      if (decision === 'poison') {
        const targetId = decideWitchPoisonTarget({ state, aiPlayer: witch });
        applyWitchAction(state, witch.playerId, 'poison', targetId);
      } else {
        applyWitchAction(state, witch.playerId, decision);
      }
      return true;
    }

    if (this.pendingHumans().length > 0) return false;

    this.lastBroadcast = null;
    resolveNight(state);
    return true;
  }

  private stepFinalSpeech(): boolean {
    const state = this.state;
    const deadThisRound = [...state.deadTonight, ...state.deadToday];

    for (const id of deadThisRound) {
      if (state.finalSpeechStatus[id]) continue;
      if (!this.isAi(id)) continue;
      const dead = state.players.find((p) => p.playerId === id);
      if (!dead) continue;
      const speech = generateAiFinalSpeech(dead.role, dead.nickname);
      applyFinalSpeech(state, id, speech);
      return true;
    }

    if (deadThisRound.some((id) => !state.finalSpeechStatus[id])) return false;

    this.lastBroadcast = null;
    resolveFinalSpeech(state);
    return true;
  }

  private stepDay(): boolean {
    const state = this.state;
    const alive = getAlivePlayers(state);

    for (const p of alive) {
      if (this.isAi(p.playerId) && !state.speechStatus[p.playerId]) {
        applyDaySpeak(state, p.playerId, generateDaySpeech({ state, aiPlayer: p }));
        return true;
      }
    }

    if (alive.some((p) => !state.speechStatus[p.playerId])) return false;

    this.lastBroadcast = null;
    startVotePhase(state);
    return true;
  }

  private stepVote(): boolean {
    const state = this.state;
    const alive = getAlivePlayers(state);

    for (const p of alive) {
      if (this.isAi(p.playerId) && !state.voteStatus[p.playerId]) {
        const { targetId } = decideVote({ state, aiPlayer: p });
        applyVote(state, p.playerId, targetId);
        return true;
      }
    }

    if (alive.some((p) => !state.voteStatus[p.playerId])) return false;

    this.lastBroadcast = null;
    resolveVote(state);
    return true;
  }
}

export type { PlayerState };
