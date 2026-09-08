import type { UndercoverGameState } from './who-is-undercover-types';
import { UNDERCOVER_ROLE_LABELS } from './who-is-undercover-types';
import { GameError, type EngineAction, type GamePlayerInfo } from './errors';
import { BaseGameEngine } from './base-engine';
import {
  initUndercoverState,
  getAlivePlayers,
  currentSpeaker,
  applyDescription,
  applyDescriptionSkip,
  startVoting,
  applyUndercoverVote,
  resolveUndercoverVote,
  generateUndercoverDescription,
  decideUndercoverVote,
  getUndercoverView,
} from './who-is-undercover-engine';

const DESCRIBE_DEADLINE_MS = 30_000;
const VOTE_DEADLINE_MS = 45_000;

/** 谁是卧底引擎 */
export class UndercoverGame extends BaseGameEngine {
  private state: UndercoverGameState;

  constructor(players: GamePlayerInfo[], state?: Record<string, unknown>) {
    super(players);
    if (state) {
      if (state.format !== 2) throw new GameError('unsupported_state', '旧版本游戏状态无法恢复');
      this.state = state as unknown as UndercoverGameState;
    } else {
      this.state = initUndercoverState(
        players.map((p) => ({ playerId: p.playerId, nickname: p.nickname })),
      );
    }
  }

  getState(): Record<string, unknown> {
    return this.state as unknown as Record<string, unknown>;
  }

  isFinished(): boolean {
    return this.state.phase === 'result';
  }

  getResults(): Record<string, { won: boolean; role: string }> | null {
    if (!this.state.winner) return null;
    const winner = this.state.winner;
    const results: Record<string, { won: boolean; role: string }> = {};
    for (const p of this.state.players) {
      results[p.playerId] = {
        won: p.role === 'undercover' ? winner === 'undercover' : winner === 'civilians',
        role: UNDERCOVER_ROLE_LABELS[p.role],
      };
    }
    return results;
  }

  getView(playerId: string | null, _isJudge?: boolean): Record<string, unknown> {
    return getUndercoverView(this.state, playerId) as Record<string, unknown>;
  }

  getRoles(): Record<string, string> {
    const roles: Record<string, string> = {};
    for (const p of this.state.players) roles[p.playerId] = UNDERCOVER_ROLE_LABELS[p.role];
    return roles;
  }

  phaseDeadlineMs(): number {
    return this.state.phase === 'describing' ? DESCRIBE_DEADLINE_MS : VOTE_DEADLINE_MS;
  }

  pendingHumans(): string[] {
    const state = this.state;
    if (state.phase === 'result') return [];

    if (state.phase === 'describing') {
      const speaker = currentSpeaker(state);
      if (speaker && !this.isAi(speaker.playerId)) return [speaker.playerId];
      return [];
    }

    // voting
    return getAlivePlayers(state)
      .filter((p) => !this.isAi(p.playerId) && !state.voteStatus[p.playerId])
      .map((p) => p.playerId);
  }

  handleAction(action: EngineAction): void {
    switch (action.type) {
      case 'describe':
        applyDescription(this.state, action.playerId, action.content ?? '');
        break;
      case 'describe_skip':
        applyDescriptionSkip(this.state, action.playerId);
        break;
      case 'vote':
        applyUndercoverVote(this.state, action.playerId, action.targetId ?? null);
        break;
      case 'vote_abstain':
        applyUndercoverVote(this.state, action.playerId, null);
        break;
      default:
        throw new GameError('unknown_action', `未知动作：${action.type}`);
    }
  }

  autoAct(playerId: string): void {
    const state = this.state;
    if (state.phase === 'describing') {
      const speaker = currentSpeaker(state);
      if (speaker?.playerId === playerId) applyDescriptionSkip(state, playerId);
      return;
    }
    if (state.phase === 'voting') {
      applyUndercoverVote(state, playerId, null);
    }
  }

  step(): boolean {
    const state = this.state;
    if (state.phase === 'result') return false;

    if (state.phase === 'describing') {
      const speaker = currentSpeaker(state);
      if (!speaker) {
        startVoting(state);
        return true;
      }
      if (!this.isAi(speaker.playerId)) return false;
      applyDescription(state, speaker.playerId, generateUndercoverDescription(state, speaker));
      return true;
    }

    // voting
    const alive = getAlivePlayers(state);
    for (const p of alive) {
      if (this.isAi(p.playerId) && !state.voteStatus[p.playerId]) {
        const { targetId } = decideUndercoverVote(state, p);
        applyUndercoverVote(state, p.playerId, targetId);
        return true;
      }
    }
    if (alive.some((p) => !state.voteStatus[p.playerId])) return false;

    resolveUndercoverVote(state);
    return true;
  }
}
