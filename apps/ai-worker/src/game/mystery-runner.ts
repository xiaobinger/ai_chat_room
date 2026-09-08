import type { DiscussionEntry } from './mystery-types';
import {
  initMysteryState,
  discoverClue,
  addDiscussion,
  resolveMysteryVote,
  generateMysterySpeech,
  decideMysteryVote,
} from './mystery-engine';

export interface MysteryGameEvent {
  type: 'phase_changed' | 'clue_found' | 'player_acted' | 'vote_result' | 'game_ended';
  payload: Record<string, unknown>;
}

export interface MysteryPlayerInfo {
  playerId: string;
  nickname: string;
  isAi: boolean;
}

/**
 * 剧本杀游戏运行器
 */
export class MysteryGameRunner {
  private state: MysteryGameState;
  private players: MysteryPlayerInfo[];
  private listeners: ((event: MysteryGameEvent) => void)[] = [];

  constructor(players: MysteryPlayerInfo[]) {
    this.players = players;
    this.state = initMysteryState(players.map((p) => ({ playerId: p.playerId, nickname: p.nickname })));
  }

  getState(): MysteryGameState {
    return this.state;
  }

  onEvent(listener: (event: MysteryGameEvent) => void): void {
    this.listeners.push(listener);
  }

  private emit(event: MysteryGameEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private getAiPlayers(): MysteryPlayerInfo[] {
    return this.players.filter((p) => p.isAi);
  }

  /** 执行 AI 介绍阶段 */
  async processIntroductions(): Promise<void> {
    const aiPlayers = this.getAiPlayers();

    for (const ai of aiPlayers) {
      const playerState = this.state.players.find((p) => p.playerId === ai.playerId);
      if (!playerState) continue;

      const speech = generateMysterySpeech(this.state, playerState, 'introduction');
      this.state = addDiscussion(this.state, ai.playerId, speech, 'statement');
    }

    this.emit({ type: 'phase_changed', payload: { phase: this.state.phase } });
  }

  /** 执行 AI 调查阶段（搜索线索） */
  async processInvestigation(): Promise<void> {
    const aiPlayers = this.getAiPlayers();

    for (const ai of aiPlayers) {
      const playerState = this.state.players.find((p) => p.playerId === ai.playerId);
      if (!playerState || playerState.hasSearched) continue;

      // 随机搜索一条未发现的线索
      const undiscovered = this.state.clues.filter((c) => !this.state.discoveredClues.includes(c.id));
      if (undiscovered.length > 0) {
        const clue = undiscovered[Math.floor(Math.random() * undiscovered.length)];
        this.state = discoverClue(this.state, ai.playerId, clue.id);
        this.emit({ type: 'clue_found', payload: { playerId: ai.playerId, clueId: clue.id } });
      }

      // AI 发言
      const speech = generateMysterySpeech(this.state, playerState, 'investigation');
      this.state = addDiscussion(this.state, ai.playerId, speech, 'statement');
    }
  }

  /** 执行 AI 讨论阶段 */
  async processDiscussion(): Promise<void> {
    const aiPlayers = this.getAiPlayers();

    for (const ai of aiPlayers) {
      const playerState = this.state.players.find((p) => p.playerId === ai.playerId);
      if (!playerState || playerState.hasSpoken) continue;

      const speech = generateMysterySpeech(this.state, playerState, 'discussion');
      this.state = addDiscussion(this.state, ai.playerId, speech, 'statement');
    }
  }

  /** 执行 AI 指控阶段 */
  async processAccusations(): Promise<void> {
    const aiPlayers = this.getAiPlayers();

    for (const ai of aiPlayers) {
      const playerState = this.state.players.find((p) => p.playerId === ai.playerId);
      if (!playerState) continue;

      const speech = generateMysterySpeech(this.state, playerState, 'accusation');
      this.state = addDiscussion(this.state, ai.playerId, speech, 'accusation');
    }
  }

  /** 执行 AI 投票 */
  async processAiVotes(): Promise<void> {
    const aiPlayers = this.getAiPlayers();

    for (const ai of aiPlayers) {
      const playerState = this.state.players.find((p) => p.playerId === ai.playerId);
      if (!playerState || this.state.votes[ai.playerId]) continue;

      const vote = decideMysteryVote(this.state, playerState);
      this.state.votes[vote.playerId] = vote.targetId;
    }
  }

  /** 结算投票 */
  resolveVotes(): void {
    this.state = resolveMysteryVote(this.state);
    this.emit({ type: 'vote_result', payload: { winner: this.state.winner } });

    if (this.state.winner) {
      this.emit({ type: 'game_ended', payload: { winner: this.state.winner } });
    }
  }

  /** 处理人类玩家动作 */
  handlePlayerAction(action: { type: string; playerId: string; targetId?: string; content?: string; clueId?: string }): void {
    if (action.type === 'search' && action.clueId) {
      this.state = discoverClue(this.state, action.playerId, action.clueId);
      this.emit({ type: 'clue_found', payload: { playerId: action.playerId, clueId: action.clueId } });
    } else if (action.type === 'speak' && action.content) {
      const entryType = action.content.includes('?') ? 'question' :
        action.content.includes('嫌疑') || action.content.includes('凶手') ? 'accusation' : 'statement';
      this.state = addDiscussion(this.state, action.playerId, action.content, entryType as DiscussionEntry['type']);
    } else if (action.type === 'vote' && action.targetId) {
      this.state.votes[action.playerId] = action.targetId;
    }
  }

  /** 进入下一阶段 */
  advancePhase(): void {
    const phaseOrder: MysteryGameState['phase'][] = ['introduction', 'investigation', 'discussion', 'voting', 'reveal'];
    const currentIndex = phaseOrder.indexOf(this.state.phase);

    if (currentIndex < phaseOrder.length - 1) {
      this.state.phase = phaseOrder[currentIndex + 1];

      // 重置玩家状态
      this.state.players.forEach((p) => {
        p.hasSpoken = false;
        p.hasSearched = false;
      });

      this.emit({ type: 'phase_changed', payload: { phase: this.state.phase } });
    }
  }
}
