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

const pick = <T>(list: T[]): T | undefined =>
  list.length > 0 ? list[Math.floor(Math.random() * list.length)] : undefined;

/** 狼人杀引擎：驱动阶段机与 AI 行为 */
export class WerewolfGame extends BaseGameEngine {
  private state: GameState;

  constructor(players: GamePlayerInfo[], state?: Record<string, unknown>) {
    super(players);
    if (state) {
      if (state.format !== 2) throw new GameError('unsupported_state', '旧版本游戏状态无法恢复');
      this.state = state as unknown as GameState;
    } else {
      this.state = initGameState(players.map((p) => ({ playerId: p.playerId, nickname: p.nickname })));
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

  getView(playerId: string | null): Record<string, unknown> {
    return getPlayerView(this.state, playerId);
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
          // 无可查目标：占位标记已完成，避免阶段卡死
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
    }
    return false;
  }

  private stepNight(): boolean {
    const state = this.state;
    const alive = getAlivePlayers(state);

    // AI 狼人依次投票
    for (const p of alive) {
      if (p.role === 'werewolf' && this.isAi(p.playerId) && !state.wolfVotes[p.playerId]) {
        const targetId = decideWolfKill({ state, aiPlayer: p });
        if (targetId) applyWolfKill(state, p.playerId, targetId);
        return true;
      }
    }

    // AI 预言家查验（无可查目标时用自身 id 占位标记"今晚已行动"，防止空转）
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

    // AI 女巫用药
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

    // AI 全部行动完，若还有人类未行动则等待
    if (this.pendingHumans().length > 0) return false;

    resolveNight(state);
    return true;
  }

  private stepDay(): boolean {
    const state = this.state;
    const alive = getAlivePlayers(state);

    // AI 按座位顺序发言
    for (const p of alive) {
      if (this.isAi(p.playerId) && !state.speechStatus[p.playerId]) {
        applyDaySpeak(state, p.playerId, generateDaySpeech({ state, aiPlayer: p }));
        return true;
      }
    }

    // 还有存活玩家没发言（人类）→ 等待
    if (alive.some((p) => !state.speechStatus[p.playerId])) return false;

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

    resolveVote(state);
    return true;
  }
}

/** 供类型引用 */
export type { PlayerState };
