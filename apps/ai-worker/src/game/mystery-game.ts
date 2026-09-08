import type { MysteryGameState, MysteryPlayerState } from './mystery-types';
import { GameError, type EngineAction, type GamePlayerInfo } from './errors';
import { BaseGameEngine } from './base-engine';
import {
  initMysteryState,
  getAlivePlayers,
  addDiscussion,
  skipDiscussion,
  searchRandomClue,
  applyMysteryVote,
  resolveMysteryVote,
  generateMysterySpeech,
  decideMysteryVote,
  getPlayerView,
} from './mystery-engine';

const SPEECH_DEADLINE_MS = 60_000;
const SEARCH_DEADLINE_MS = 45_000;
const VOTE_DEADLINE_MS = 45_000;

/** 剧本杀引擎 */
export class MysteryGame extends BaseGameEngine {
  private state: MysteryGameState;

  constructor(players: GamePlayerInfo[], state?: Record<string, unknown>) {
    super(players);
    if (state) {
      if (state.format !== 2) throw new GameError('unsupported_state', '旧版本游戏状态无法恢复');
      this.state = state as unknown as MysteryGameState;
    } else {
      this.state = initMysteryState(players.map((p) => ({ playerId: p.playerId, nickname: p.nickname })));
    }
  }

  getState(): Record<string, unknown> {
    return this.state as unknown as Record<string, unknown>;
  }

  isFinished(): boolean {
    return this.state.phase === 'reveal';
  }

  getResults(): Record<string, { won: boolean; role: string }> | null {
    if (!this.state.winner) return null;
    const winner = this.state.winner;
    const results: Record<string, { won: boolean; role: string }> = {};
    for (const p of this.state.players) {
      results[p.playerId] = {
        won: p.character.isMurderer ? winner === 'murderer' : winner === 'detectives',
        role: p.character.isMurderer ? '凶手' : p.character.name,
      };
    }
    return results;
  }

  getView(playerId: string | null): Record<string, unknown> {
    return getPlayerView(this.state, playerId) as Record<string, unknown>;
  }

  getRoles(): Record<string, string> {
    const roles: Record<string, string> = {};
    for (const p of this.state.players) roles[p.playerId] = p.character.name;
    return roles;
  }

  phaseDeadlineMs(): number {
    switch (this.state.phase) {
      case 'introduction':
      case 'discussion':
        return SPEECH_DEADLINE_MS;
      case 'investigation':
        return SEARCH_DEADLINE_MS;
      default:
        return VOTE_DEADLINE_MS;
    }
  }

  pendingHumans(): string[] {
    const state = this.state;
    if (state.phase === 'reveal') return [];
    const alive = getAlivePlayers(state);

    switch (state.phase) {
      case 'introduction':
      case 'discussion':
        return alive
          .filter((p) => !this.isAi(p.playerId) && !p.hasSpoken)
          .map((p) => p.playerId);
      case 'investigation':
        return alive
          .filter((p) => !this.isAi(p.playerId) && !p.hasSearched)
          .map((p) => p.playerId);
      case 'voting':
        return alive
          .filter((p) => !this.isAi(p.playerId) && !state.voteStatus[p.playerId])
          .map((p) => p.playerId);
      default:
        return [];
    }
  }

  handleAction(action: EngineAction): void {
    switch (action.type) {
      case 'speak':
        this.state = addDiscussion(this.state, action.playerId, action.content ?? '', 'statement');
        return;
      case 'speak_skip':
        this.state = skipDiscussion(this.state, action.playerId);
        return;
      case 'search': {
        const me = this.requireAliveInvestigator(action.playerId);
        if (me.hasSearched) throw new GameError('already_searched', '本轮已搜证');
        const next = searchRandomClue(this.state, action.playerId);
        // 无论是否发现新线索，搜证机会都已消耗
        next.players.find((p) => p.playerId === action.playerId)!.hasSearched = true;
        this.state = next;
        return;
      }
      case 'vote':
        this.state = applyMysteryVote(this.state, action.playerId, action.targetId ?? null);
        return;
      case 'vote_abstain':
        this.state = applyMysteryVote(this.state, action.playerId, null);
        return;
      default:
        throw new GameError('unknown_action', `未知动作：${action.type}`);
    }
  }

  private requireAliveInvestigator(playerId: string): MysteryPlayerState {
    const me = this.state.players.find((p) => p.playerId === playerId);
    if (!me) throw new GameError('player_not_found', '玩家不存在');
    if (!me.isAlive) throw new GameError('player_dead', '你已出局');
    if (this.state.phase !== 'investigation') throw new GameError('not_investigation', '当前不是搜证阶段');
    return me;
  }

  autoAct(playerId: string): void {
    const state = this.state;
    const me = state.players.find((p) => p.playerId === playerId);
    if (!me || !me.isAlive) return;

    switch (state.phase) {
      case 'introduction':
      case 'discussion':
        if (!me.hasSpoken) this.state = skipDiscussion(state, playerId);
        return;
      case 'investigation':
        if (!me.hasSearched) this.handleAction({ type: 'search', playerId });
        return;
      case 'voting':
        if (!state.voteStatus[playerId]) {
          this.state = applyMysteryVote(state, playerId, null);
        }
        return;
      default:
        return;
    }
  }

  step(): boolean {
    const state = this.state;
    if (state.phase === 'reveal') return false;
    const alive = getAlivePlayers(state);

    switch (state.phase) {
      case 'introduction': {
        for (const p of alive) {
          if (this.isAi(p.playerId) && !p.hasSpoken) {
            this.state = addDiscussion(state, p.playerId, generateMysterySpeech(state, p, 'introduction'), 'statement');
            return true;
          }
        }
        if (alive.some((p) => !p.hasSpoken)) return false;
        this.transition('investigation', '自我介绍结束，进入搜证阶段');
        return true;
      }
      case 'investigation': {
        for (const p of alive) {
          if (this.isAi(p.playerId) && !p.hasSearched) {
            this.state = searchRandomClue(state, p.playerId);
            // searchRandomClue 不会标记 hasSearched（discoverClue 只管线索），这里补上
            this.state.players.find((x) => x.playerId === p.playerId)!.hasSearched = true;
            return true;
          }
        }
        if (alive.some((p) => !p.hasSearched)) return false;
        // 重置发言状态，进入讨论
        for (const p of state.players) p.hasSpoken = false;
        this.transition('discussion', '搜证结束，进入圆桌讨论');
        return true;
      }
      case 'discussion': {
        for (const p of alive) {
          if (this.isAi(p.playerId) && !p.hasSpoken) {
            this.state = addDiscussion(state, p.playerId, generateMysterySpeech(state, p, 'discussion'), 'statement');
            return true;
          }
        }
        if (alive.some((p) => !p.hasSpoken)) return false;
        this.transition('voting', '讨论结束，进入最终指认投票');
        return true;
      }
      case 'voting': {
        for (const p of alive) {
          if (this.isAi(p.playerId) && !state.voteStatus[p.playerId]) {
            const { targetId } = decideMysteryVote(state, p);
            this.state = applyMysteryVote(state, p.playerId, targetId);
            return true;
          }
        }
        if (alive.some((p) => !state.voteStatus[p.playerId])) return false;
        this.state = resolveMysteryVote(state);
        return true;
      }
      default:
        return false;
    }
  }

  private transition(phase: MysteryGameState['phase'], message: string): void {
    this.state.phase = phase;
    this.state.events.push({
      id: crypto.randomUUID(),
      round: this.state.round,
      phase,
      type: 'phase_change',
      content: message,
      timestamp: Date.now(),
    });
  }
}
