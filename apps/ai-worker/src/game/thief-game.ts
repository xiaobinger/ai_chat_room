import type { ThiefGameState, ThiefPlayerState } from './who-is-the-thief-types';
import { THIEF_PERSONA_DESCRIPTIONS, THIEF_ROLE_LABELS } from './who-is-the-thief-types';
import { GameError, type EngineAction, type GamePlayerInfo } from './errors';
import { BaseGameEngine } from './base-engine';
import {
  initThiefGameState,
  getAlivePlayers,
  applyThiefSpeech,
  applyThiefSkip,
  applyDetectiveInvestigate,
  applyFrame,
  applyRevealClue,
  startThiefVoting,
  applyThiefVote,
  resolveThiefVote,
  generateInvestigationSpeech,
  decideDetectiveTarget,
  decideThiefVote,
  decideWitnessReveal,
  decideFrameTarget,
  getThiefView,
} from './who-is-the-thief-engine';
import { generateLlmSpeech } from './speech-generator';

const INVESTIGATION_DEADLINE_MS = 60_000;
const VOTE_DEADLINE_MS = 45_000;

/** 谁是凶手引擎 */
export class ThiefGame extends BaseGameEngine {
  private state: ThiefGameState;
  private speechProvider: import('../model-provider').ModelProvider | null = null;

  constructor(
    players: GamePlayerInfo[],
    state?: Record<string, unknown>,
    options?: { speechProvider?: import('../model-provider').ModelProvider },
  ) {
    super(players);
    this.speechProvider = options?.speechProvider ?? null;
    if (state) {
      if (state.format !== 2) throw new GameError('unsupported_state', '旧版本游戏状态无法恢复');
      this.state = state as unknown as ThiefGameState;
    } else {
      this.state = initThiefState(players);
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
      const isThiefTeam = this.state.thiefTeamIds.includes(p.playerId);
      results[p.playerId] = {
        won: isThiefTeam ? winner === 'thief' : winner === 'citizen',
        role: THIEF_ROLE_LABELS[p.role],
      };
    }
    return results;
  }

  getView(playerId: string | null, _isJudge?: boolean): Record<string, unknown> {
    return getThiefView(this.state, playerId) as Record<string, unknown>;
  }

  getRoles(): Record<string, string> {
    const roles: Record<string, string> = {};
    for (const p of this.state.players) roles[p.playerId] = THIEF_ROLE_LABELS[p.role];
    return roles;
  }

  phaseDeadlineMs(): number {
    return this.state.phase === 'voting' ? VOTE_DEADLINE_MS : INVESTIGATION_DEADLINE_MS;
  }

  pendingHumans(): string[] {
    const state = this.state;
    if (state.phase === 'result') return [];
    if (state.phase === 'investigation') {
      return getAlivePlayers(state)
        .filter((p) => !this.isAi(p.playerId) && !p.hasSpoken)
        .map((p) => p.playerId);
    }
    return getAlivePlayers(state)
      .filter((p) => !this.isAi(p.playerId) && !state.voteStatus[p.playerId])
      .map((p) => p.playerId);
  }

  handleAction(action: EngineAction): void {
    switch (action.type) {
      case 'speak':
        applyThiefSpeech(this.state, action.playerId, action.content ?? '');
        break;
      case 'speak_skip':
        applyThiefSkip(this.state, action.playerId);
        break;
      case 'investigate':
        applyDetectiveInvestigate(this.state, action.playerId, action.targetId ?? '');
        break;
      case 'frame':
        applyFrame(this.state, action.playerId, action.targetId ?? '');
        break;
      case 'reveal_clue':
        applyRevealClue(this.state, action.playerId);
        break;
      case 'vote':
        applyThiefVote(this.state, action.playerId, action.targetId ?? null);
        break;
      case 'vote_abstain':
        applyThiefVote(this.state, action.playerId, null);
        break;
      default:
        throw new GameError('unknown_action', `未知动作：${action.type}`);
    }
  }

  autoAct(playerId: string): void {
    const state = this.state;
    if (state.phase === 'investigation') {
      const me = state.players.find((p) => p.playerId === playerId);
      if (me?.isAlive && !me.hasSpoken) applyThiefSkip(state, playerId);
      return;
    }
    if (state.phase === 'voting') {
      applyThiefVote(state, playerId, null);
    }
  }

  async step(): Promise<boolean> {
    const state = this.state;
    if (state.phase === 'result') return false;

    if (state.phase === 'investigation') {
      return this.stepInvestigation();
    }
    return this.stepVoting();
  }

  private async stepInvestigation(): Promise<boolean> {
    const state = this.state;
    const alive = getAlivePlayers(state);

    // 第二阶段：真正调用大模型
    if (state.typingPlayerId) {
      const pendingId = state.typingPlayerId;
      state.typingPlayerId = null;
      const p = state.players.find((x) => x.playerId === pendingId);
      if (p && this.isAi(p.playerId) && !p.hasSpoken) {
        await this.speakFor(p);
        return true;
      }
    }

    // 1. AI 依次发言
    for (const p of alive) {
      if (this.isAi(p.playerId) && !p.hasSpoken) {
        if (this.speechProvider) {
          state.typingPlayerId = p.playerId;
          return true;
        }
        applyThiefSpeech(state, p.playerId, generateInvestigationSpeech(state, p));
        return true;
      }
    }

    // 2. AI 侦探调查（本轮一次）
    const detective = alive.find((p) => p.role === 'detective');
    if (detective && this.isAi(detective.playerId) && !detective.hasInvestigated) {
      const targetId = decideDetectiveTarget(state, detective);
      if (targetId) applyDetectiveInvestigate(state, detective.playerId, targetId);
      return true;
    }

    // 3. AI 目击者公开线索
    const witness = alive.find((p) => p.role === 'witness');
    if (witness && this.isAi(witness.playerId) && !witness.hasRevealedClue && decideWitnessReveal(state)) {
      applyRevealClue(state, witness.playerId);
      return true;
    }

    // 4. AI 小偷嫁祸（整局一次，第二轮起或首轮一半概率）
    const thief = alive.find((p) => p.role === 'thief' || p.role === 'master_thief');
    if (
      thief &&
      this.isAi(thief.playerId) &&
      !thief.hasFramed &&
      (state.round >= 2 || Math.random() < 0.5)
    ) {
      const targetId = decideFrameTarget(state, thief);
      if (targetId) applyFrame(state, thief.playerId, targetId);
      return true;
    }

    // 5. 等待未发言的人类
    if (alive.some((p) => !p.hasSpoken)) return false;

    startThiefVoting(state);
    return true;
  }

  private stepVoting(): boolean {
    const state = this.state;
    const alive = getAlivePlayers(state);

    for (const p of alive) {
      if (this.isAi(p.playerId) && !state.voteStatus[p.playerId]) {
        const { targetId } = decideThiefVote(state, p);
        applyThiefVote(state, p.playerId, targetId);
        return true;
      }
    }

    if (alive.some((p) => !state.voteStatus[p.playerId])) return false;

    resolveThiefVote(state);
    return true;
  }

  private async speakFor(player: ThiefPlayerState): Promise<void> {
    if (!this.speechProvider) {
      applyThiefSpeech(this.state, player.playerId, generateInvestigationSpeech(this.state, player));
      return;
    }

    const recentEvents = [
      ...this.state.publicNotes.slice(-2).map((note) => note.content),
      ...this.state.speechLog.slice(-4).map((speech) => `${speech.nickname}: ${speech.content}`),
      ...this.state.revealedClues.slice(-2).map((clue) => `公开线索：${clue}`),
    ];

    // 提取该玩家自己的前几次发言，用于防重复
    const ownPreviousSpeeches = this.state.speechLog
      .filter((s) => s.playerId === player.playerId)
      .slice(-3)
      .map((s) => s.content);

    const customHints: Record<ThiefPlayerState['role'], string> = {
      thief: '你是小偷，要隐藏身份并把怀疑引到别人身上。',
      master_thief: '你是神偷，要像核心带节奏者一样说话，但不能暴露自己。',
      accomplice: '你是同伙，要帮小偷转移压力，顺势带偏怀疑方向。',
      detective: '你是侦探，请结合已有调查笔记和公开线索，引导大家关注真正可疑的人。',
      witness: '你是目击者，请结合自己掌握的线索，自然地提醒大家关注关键破绽。',
      citizen: '你是普通市民，请像真人玩家一样根据公开发言和线索推理。',
    };

    const llmSpeech = await generateLlmSpeech(this.speechProvider, {
      game: 'who_is_the_thief',
      nickname: player.nickname,
      gameRole: THIEF_ROLE_LABELS[player.role],
      personality: THIEF_PERSONA_DESCRIPTIONS[player.persona] ?? player.persona,
      phase: '调查发言',
      round: this.state.round,
      recentEvents,
      timeoutMs: 30_000,
      customHint: customHints[player.role],
      ownPreviousSpeeches,
    });

    if (llmSpeech && llmSpeech.trim().length >= 2) {
      applyThiefSpeech(this.state, player.playerId, llmSpeech);
    } else {
      // 大模型不可用/超时/空响应：回退模板发言，避免 AI 集体沉默
      applyThiefSpeech(this.state, player.playerId, generateInvestigationSpeech(this.state, player));
    }
  }
}

function initThiefState(players: GamePlayerInfo[]): ThiefGameState {
  return initThiefGameState(players.map((p) => ({ playerId: p.playerId, nickname: p.nickname })));
}

export type { ThiefPlayerState };
