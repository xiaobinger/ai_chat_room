import type { GameState, GameAction, GameLogEntry } from './types';
import {
  initGameState,
  processAction,
  transitionToDay,
  transitionToNight,
  resolveVote,
  checkGameEnd,
  getAlivePlayers,
} from './werewolf-engine';
import { decideNightAction, generateDaySpeech, decideVote } from './ai-decision';

export interface GamePlayerInfo {
  playerId: string;
  nickname: string;
  isAi: boolean;
}

export interface GameEvent {
  type: 'phase_changed' | 'player_died' | 'vote_result' | 'game_ended' | 'ai_action';
  payload: Record<string, unknown>;
}

/**
 * 狼人杀游戏运行器
 * 管理游戏状态、阶段切换、AI 行动
 */
export class WerewolfGameRunner {
  private state: GameState;
  private players: GamePlayerInfo[];
  private listeners: ((event: GameEvent) => void)[] = [];

  constructor(players: GamePlayerInfo[]) {
    this.players = players;
    this.state = initGameState(players.map((p) => ({ playerId: p.playerId, nickname: p.nickname })));
  }

  getState(): GameState {
    return this.state;
  }

  onEvent(listener: (event: GameEvent) => void): void {
    this.listeners.push(listener);
  }

  private emit(event: GameEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /** 记录游戏事件 */
  private logEvent(
    type: GameLogEntry['type'],
    content: string,
    actorId?: string,
    targetId?: string,
  ): void {
    const actor = actorId ? this.state.players.find((p) => p.playerId === actorId) : undefined;
    const target = targetId ? this.state.players.find((p) => p.playerId === targetId) : undefined;
    this.state.events.push({
      id: crypto.randomUUID(),
      round: this.state.round,
      phase: this.state.phase,
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

  /** 获取 AI 玩家列表 */
  private getAiPlayers(): GamePlayerInfo[] {
    return this.players.filter((p) => p.isAi);
  }

  /** 获取玩家信息 */
  private getPlayerInfo(playerId: string): GamePlayerInfo | undefined {
    return this.players.find((p) => p.playerId === playerId);
  }

  /** 执行 AI 夜晚行动 */
  async processNightActions(): Promise<void> {
    const aiPlayers = this.getAiPlayers();
    const alivePlayers = getAlivePlayers(this.state);

    for (const ai of aiPlayers) {
      const aiState = this.state.players.find((p) => p.playerId === ai.playerId);
      if (!aiState?.isAlive) continue;

      const action = decideNightAction({
        state: this.state,
        aiPlayer: aiState,
        alivePlayers,
      });

      if (action) {
        this.state = processAction(this.state, action);
        const targetName = action.targetId
          ? this.state.players.find((p) => p.playerId === action.targetId)?.nickname
          : undefined;
        if (action.type === 'werewolf_kill') {
          this.logEvent('player_action', `${ai.nickname} 选择了杀死 ${targetName}`, ai.playerId, action.targetId);
        } else if (action.type === 'seer_check') {
          this.logEvent('player_action', `${ai.nickname} 查验了 ${targetName}`, ai.playerId, action.targetId);
        } else if (action.type === 'witch_save') {
          this.logEvent('player_action', `${ai.nickname} 使用解药救活了 ${targetName}`, ai.playerId, action.targetId);
        } else if (action.type === 'witch_poison') {
          this.logEvent('player_action', `${ai.nickname} 使用毒药毒死了 ${targetName}`, ai.playerId, action.targetId);
        }
        this.emit({ type: 'ai_action', payload: { playerId: ai.playerId, action: action.type } });
      }
    }

    // 进入白天
    this.state = transitionToDay(this.state);
    this.logEvent('phase_change', `第 ${this.state.round} 天 白天来临`);

    // 检查是否有人死亡
    if (this.state.deadTonight.length > 0) {
      const deadNames = this.state.deadTonight
        .map((id) => this.state.players.find((p) => p.playerId === id)?.nickname ?? '未知')
        .join('、');
      this.logEvent('player_death', `昨晚死亡：${deadNames}`, undefined, this.state.deadTonight[0]);
      this.emit({ type: 'player_died', payload: { players: this.state.deadTonight, names: deadNames, phase: 'night' } });
    } else {
      this.logEvent('player_death', '昨晚平安夜，无人死亡');
    }

    // 检查游戏是否结束
    this.state = checkGameEnd(this.state);
    if (this.state.winner) {
      this.logEvent('game_end', this.state.winner === 'werewolf' ? '狼人胜利！' : '村民胜利！');
      this.emit({ type: 'game_ended', payload: { winner: this.state.winner } });
    }

    this.emit({ type: 'phase_changed', payload: { phase: this.state.phase, round: this.state.round } });
  }

  /** 执行 AI 白天发言 */
  async processDaySpeeches(): Promise<void> {
    const aiPlayers = this.getAiPlayers();
    const alivePlayers = getAlivePlayers(this.state);

    for (const ai of aiPlayers) {
      const aiState = this.state.players.find((p) => p.playerId === ai.playerId);
      if (!aiState?.isAlive) continue;

      const action = generateDaySpeech({
        state: this.state,
        aiPlayer: aiState,
        alivePlayers,
      });

      this.state = processAction(this.state, action);
      this.logEvent('player_action', `${ai.nickname} 发言：${action.content}`, ai.playerId);
    }

    this.logEvent('phase_change', '发言结束，进入投票阶段');
    this.emit({ type: 'phase_changed', payload: { phase: 'voting' } });
  }

  /** 执行 AI 投票 */
  async processAiVotes(): Promise<void> {
    const aiPlayers = this.getAiPlayers();
    const alivePlayers = getAlivePlayers(this.state);

    for (const ai of aiPlayers) {
      const aiState = this.state.players.find((p) => p.playerId === ai.playerId);
      if (!aiState?.isAlive) continue;
      if (this.state.votes[ai.playerId]) continue; // 已投票

      const action = decideVote({
        state: this.state,
        aiPlayer: aiState,
        alivePlayers,
      });

      this.state = processAction(this.state, action);
      const targetName = this.state.players.find((p) => p.playerId === action.targetId)?.nickname;
      this.logEvent('player_action', `${ai.nickname} 投票给 ${targetName}`, ai.playerId, action.targetId);
    }
  }

  /** 结算投票 */
  resolveVotes(): void {
    this.state = resolveVote(this.state);

    if (this.state.deadToday.length > 0) {
      const deadNames = this.state.deadToday
        .map((id) => this.state.players.find((p) => p.playerId === id)?.nickname ?? '未知')
        .join('、');
      this.logEvent('vote_result', `投票结果：${deadNames} 被投出`, undefined, this.state.deadToday[0]);
      this.emit({ type: 'player_died', payload: { players: this.state.deadToday, names: deadNames, phase: 'day' } });
    } else {
      this.logEvent('vote_result', '投票结果：平票，无人出局');
    }

    this.emit({ type: 'vote_result', payload: { deadToday: this.state.deadToday, votes: this.state.votes } });

    // 检查游戏是否结束
    this.state = checkGameEnd(this.state);
    if (this.state.winner) {
      this.logEvent('game_end', this.state.winner === 'werewolf' ? '狼人胜利！' : '村民胜利！');
      this.emit({ type: 'game_ended', payload: { winner: this.state.winner } });
      return;
    }

    // 进入夜晚
    this.state = transitionToNight(this.state);
    this.logEvent('phase_change', `第 ${this.state.round} 夜 来临`);
    this.emit({ type: 'phase_changed', payload: { phase: this.state.phase, round: this.state.round } });
  }

  /** 处理人类玩家动作 */
  handlePlayerAction(action: GameAction): void {
    const actor = this.state.players.find((p) => p.playerId === action.playerId);
    const target = action.targetId ? this.state.players.find((p) => p.playerId === action.targetId) : undefined;

    this.state = processAction(this.state, action);

    if (action.type === 'day_speak') {
      this.logEvent('player_action', `${actor?.nickname} 发言：${action.content}`, action.playerId);
    } else if (action.type === 'vote') {
      this.logEvent('player_action', `${actor?.nickname} 投票给 ${target?.nickname}`, action.playerId, action.targetId);
    } else if (action.type === 'werewolf_kill') {
      this.logEvent('player_action', `${actor?.nickname} 选择了杀死 ${target?.nickname}`, action.playerId, action.targetId);
    } else if (action.type === 'seer_check') {
      this.logEvent('player_action', `${actor?.nickname} 查验了 ${target?.nickname}`, action.playerId, action.targetId);
    } else if (action.type === 'witch_save') {
      this.logEvent('player_action', `${actor?.nickname} 使用解药救活了 ${target?.nickname}`, action.playerId, action.targetId);
    } else if (action.type === 'witch_poison') {
      this.logEvent('player_action', `${actor?.nickname} 使用毒药毒死了 ${target?.nickname}`, action.playerId, action.targetId);
    }
  }

  /** 检查是否所有 AI 都已行动 */
  allAiActed(): boolean {
    const aiPlayers = this.getAiPlayers();
    if (this.state.phase === 'night') {
      // 简化：假设 AI 行动是即时的
      return true;
    }
    if (this.state.phase === 'vote') {
      // 投票阶段：检查是否所有存活 AI 都已投票
      const aliveAi = aiPlayers.filter((ai) => {
        const state = this.state.players.find((p) => p.playerId === ai.playerId);
        return state?.isAlive;
      });
      return aliveAi.every((ai) => this.state.votes[ai.playerId]);
    }
    return true;
  }
}
