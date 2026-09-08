import type { ThiefGameState, InvestigationAction, ThiefPlayerState } from './who-is-the-thief-types';
import {
  initThiefGameState,
  processInvestigationAction,
  transitionToVoting,
  resolveThiefVote,
  checkThiefGameEnd,
  nextInvestigationRound,
  getAlivePlayers,
  generateInvestigationSpeech,
  decideThiefVote,
} from './who-is-the-thief-engine';

export interface ThiefGameEvent {
  type: 'phase_changed' | 'player_acted' | 'player_eliminated' | 'game_ended' | 'special_event';
  payload: Record<string, unknown>;
}

export interface ThiefPlayerInfo {
  playerId: string;
  nickname: string;
  isAi: boolean;
}

/**
 * 谁是凶手游戏运行器
 */
export class ThiefGameRunner {
  private state: ThiefGameState;
  private players: ThiefPlayerInfo[];
  private listeners: ((event: ThiefGameEvent) => void)[] = [];

  constructor(players: ThiefPlayerInfo[]) {
    this.players = players;
    this.state = initThiefGameState(players.map((p) => ({ playerId: p.playerId, nickname: p.nickname })));
  }

  getState(): ThiefGameState {
    return this.state;
  }

  onEvent(listener: (event: ThiefGameEvent) => void): void {
    this.listeners.push(listener);
  }

  private emit(event: ThiefGameEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private getAiPlayers(): ThiefPlayerInfo[] {
    return this.players.filter((p) => p.isAi);
  }

  /** 执行 AI 调查阶段 */
  async processInvestigation(): Promise<void> {
    const aiPlayers = this.getAiPlayers();
    const alivePlayers = getAlivePlayers(this.state);

    for (const ai of aiPlayers) {
      const aiState = this.state.players.find((p) => p.playerId === ai.playerId);
      if (!aiState?.isAlive || aiState.hasSpoken) continue;

      const action = generateInvestigationSpeech(this.state, aiState);
      this.state = processInvestigationAction(this.state, action);
      this.emit({ type: 'player_acted', payload: { playerId: ai.playerId, action: action.type } });
    }

    // 进入投票阶段
    this.state = transitionToVoting(this.state);
    this.emit({ type: 'phase_changed', payload: { phase: 'voting', round: this.state.round } });
  }

  /** 执行 AI 投票 */
  async processAiVotes(): Promise<void> {
    const aiPlayers = this.getAiPlayers();
    const alivePlayers = getAlivePlayers(this.state);

    for (const ai of aiPlayers) {
      const aiState = this.state.players.find((p) => p.playerId === ai.playerId);
      if (!aiState?.isAlive) continue;
      if (this.state.votes[ai.playerId]) continue;

      const vote = decideThiefVote(this.state, aiState);
      this.state.votes[vote.playerId] = vote.targetId;
    }
  }

  /** 结算投票 */
  resolveVotes(): void {
    this.state = resolveThiefVote(this.state);

    if (this.state.accusedPlayerId) {
      const eliminated = this.state.players.find((p) => p.playerId === this.state.accusedPlayerId);
      this.emit({
        type: 'player_eliminated',
        payload: { playerId: this.state.accusedPlayerId, nickname: eliminated?.nickname, role: eliminated?.role },
      });
    }

    // 检查游戏是否结束
    this.state = checkThiefGameEnd(this.state);
    if (this.state.winner) {
      this.emit({ type: 'game_ended', payload: { winner: this.state.winner } });
      return;
    }

    // 进入下一轮
    this.state = nextInvestigationRound(this.state);
    this.emit({ type: 'phase_changed', payload: { phase: this.state.phase, round: this.state.round } });
  }

  /** 处理人类玩家动作 */
  handlePlayerAction(action: InvestigationAction): void {
    this.state = processInvestigationAction(this.state, action);
  }

  /** 添加游戏事件 */
  addEvent(event: ThiefGameState['events'][number]): void {
    this.state.events.push(event);
  }
}
