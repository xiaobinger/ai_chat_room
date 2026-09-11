import { prisma } from '@tianma/database';
import { roomGateway } from '../ws/room-gateway';
import { BaseGameEngine } from '../../../ai-worker/src/game/base-engine';
import { GameError, type EngineAction, type GamePlayerInfo } from '../../../ai-worker/src/game/errors';
import { WerewolfGame } from '../../../ai-worker/src/game/werewolf-game';
import { ThiefGame } from '../../../ai-worker/src/game/thief-game';
import { MysteryGame } from '../../../ai-worker/src/game/mystery-game';
import { UndercoverGame } from '../../../ai-worker/src/game/undercover-game';
import { createModelRegistry } from '../../../ai-worker/src/registry';
import type { ModelProvider } from '../../../ai-worker/src/model-provider';

export type GameTypeStr = 'werewolf' | 'murder_mystery' | 'who_is_the_thief' | 'who_is_undercover';

/** AI 行动间隔：让事件流有节奏感 */
const STEP_DELAY_MS = 900;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let cachedGameSpeechProvider: ModelProvider | null | undefined;

function resolveGameSpeechProvider(): ModelProvider | null {
  if (cachedGameSpeechProvider !== undefined) return cachedGameSpeechProvider;
  try {
    const registry = createModelRegistry();
    const requested = process.env.GAME_SPEECH_MODEL?.trim() || 'auto';
    const provider = registry.resolve(requested);
    cachedGameSpeechProvider = provider;
    console.warn(
      `[game-llm] bootstrap ${JSON.stringify({ requestedModel: requested, resolvedProvider: provider.name })}`,
    );
  } catch (error) {
    cachedGameSpeechProvider = null;
    console.warn(
      `[game-llm] disabled ${JSON.stringify({ message: error instanceof Error ? error.message : String(error) })}`,
    );
  }
  return cachedGameSpeechProvider;
}

export interface DirectorPlayerRow {
  id: string;
  userId: string | null;
  nickname: string;
  role: string;
}

export interface JudgeOptions {
  judgeMode?: 'owner' | 'ai' | null;
  /** owner 模式：房主 gamePlayerId（不在游戏玩家列表中）；ai 模式：AI 法官 gamePlayerId */
  judgePlayerId?: string | null;
  /** owner 模式：房主 userId（用于判断请求者是否为法官） */
  ownerUserId?: string | null;
}

/**
 * 游戏导演：包装引擎，负责
 * - 推进循环（AI 自动行动，人类等待）
 * - 阶段超时托管（到点自动替未行动的人类玩家决策，游戏永不卡死）
 * - 状态持久化（每步写 DB，进程重启可恢复）
 * - WS 广播（前端收到后拉取增量视角）
 * - 结束结算（角色/胜负写回 gameData）
 */
export class GameDirector {
  private static active = new Map<string, GameDirector>();

  readonly roomId: string;
  readonly gameType: GameTypeStr;
  private engine: BaseGameEngine;
  private players: GamePlayerInfo[];
  private userIdByPlayerId = new Map<string, string>();
  private ticking = false;
  private finished = false;
  private deadlineTimer: NodeJS.Timeout | null = null;
  /** 当前阶段截止时间（epoch ms），随状态一并下发给前端做倒计时 */
  private deadlineAt: number | null = null;
  /** 法官模式信息 */
  private judgeMode: 'owner' | 'ai' | null = null;
  private judgePlayerId: string | null = null;
  /** owner 模式下房主的 userId（用于判断请求者是否为法官） */
  private ownerUserId: string | null = null;

  private constructor(
    roomId: string,
    gameType: GameTypeStr,
    players: DirectorPlayerRow[],
    engine: BaseGameEngine,
    judgeOptions?: JudgeOptions,
  ) {
    this.roomId = roomId;
    this.gameType = gameType;
    this.players = players.map((p) => ({
      playerId: p.id,
      nickname: p.nickname,
      isAi: p.role === 'ai',
      userId: p.userId,
    }));
    for (const p of players) {
      if (p.userId) this.userIdByPlayerId.set(p.id, p.userId);
    }
    this.engine = engine;
    this.judgeMode = judgeOptions?.judgeMode ?? null;
    this.judgePlayerId = judgeOptions?.judgePlayerId ?? null;
    this.ownerUserId = judgeOptions?.ownerUserId ?? null;
  }

  /** 创建新游戏 */
  static create(
    roomId: string,
    gameType: GameTypeStr,
    players: DirectorPlayerRow[],
    judgeOptions?: JudgeOptions,
  ): GameDirector {
    const engine = buildEngine(gameType, players, undefined, judgeOptions);
    const director = new GameDirector(roomId, gameType, players, engine, judgeOptions);
    GameDirector.active.set(roomId, director);
    return director;
  }

  /** 从持久化状态恢复（服务器重启后首个请求触发）；旧格式抛 GameError */
  static restore(
    roomId: string,
    gameType: GameTypeStr,
    players: DirectorPlayerRow[],
    state: unknown,
  ): GameDirector {
    const engine = buildEngine(gameType, players, state as Record<string, unknown>);
    // 从持久化状态恢复法官身份（否则重启后房主法官无法再发言）
    const persisted = ((state ?? {}) as { judgeMode?: 'owner' | 'ai' | null; judgePlayerId?: string | null });
    const judgeOptions: JudgeOptions | undefined = persisted.judgeMode
      ? {
          judgeMode: persisted.judgeMode,
          judgePlayerId: persisted.judgePlayerId ?? null,
          ownerUserId: players.find((p) => p.id === persisted.judgePlayerId)?.userId ?? null,
        }
      : undefined;
    const director = new GameDirector(roomId, gameType, players, engine, judgeOptions);
    GameDirector.active.set(roomId, director);
    return director;
  }

  static get(roomId: string): GameDirector | undefined {
    return GameDirector.active.get(roomId);
  }

  static dispose(roomId: string): void {
    const director = GameDirector.active.get(roomId);
    director?.cleanup();
    GameDirector.active.delete(roomId);
  }

  /** 进程退出时清理所有导演（避免悬挂 timer） */
  static disposeAll(): void {
    for (const roomId of GameDirector.active.keys()) {
      GameDirector.dispose(roomId);
    }
  }

  private cleanup(): void {
    if (this.deadlineTimer) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }
  }

  getPlayerIdByUser(userId: string): string | null {
    for (const [playerId, uid] of this.userIdByPlayerId) {
      if (uid === userId) return playerId;
    }
    return null;
  }

  /** 检查请求用户是否为法官 */
  isJudge(userId: string): boolean {
    if (this.judgeMode !== 'owner') return false;
    return this.ownerUserId !== null && userId === this.ownerUserId;
  }

  getDeadlineAt(): number | null {
    return this.deadlineAt;
  }

  isFinished(): boolean {
    return this.finished || this.engine.isFinished();
  }

  /** 玩家（或观众）视角 */
  getView(userId: string | null): Record<string, unknown> {
    const playerId = userId ? this.getPlayerIdByUser(userId) : null;
    const isJudge = userId ? this.isJudge(userId) : false;
    return this.engine.getView(playerId, isJudge);
  }

  /** 处理人类动作：校验后交给引擎，然后恢复推进 */
  async handleUserAction(userId: string, body: { type: string; targetId?: string; content?: string }): Promise<void> {
    // 法官可以发言
    if (this.isJudge(userId)) {
      const action: EngineAction = {
        type: 'judge_speak' as any,
        playerId: this.judgePlayerId ?? '',
        targetId: body.targetId,
        content: body.content,
      };
      this.engine.handleAction(action);
      await this.persist();
      this.broadcastState();
      void this.tick();
      return;
    }

    const playerId = this.getPlayerIdByUser(userId);
    if (!playerId) throw new GameError('not_a_player', '你不是本局玩家');
    const action: EngineAction = {
      type: body.type,
      playerId,
      targetId: body.targetId,
      content: body.content,
    };
    this.engine.handleAction(action); // 校验失败抛 GameError
    await this.persist();
    this.broadcastState();
    void this.tick();
  }

  /** 启动/恢复推进 */
  async tick(): Promise<void> {
    if (this.finished || this.ticking) return;
    this.ticking = true;
    try {
      for (;;) {
        if (this.engine.isFinished()) {
          await this.finish();
          return;
        }
        // 先推进引擎（法官播报 + AI 行动），再判断是否有待行动的人类：
        // 这样主持人播报（如女巫报号）会在人类被提示前送达，AI 行动也不会因人类待行动而冻结。
        const moved = await this.engine.step();
        if (moved) {
          await this.persist();
          this.broadcastState();
          await sleep(STEP_DELAY_MS);
          continue;
        }
        const pending = this.engine.pendingHumans();
        if (pending.length > 0) {
          this.armDeadline();
          await this.persist();
          this.broadcastState();
          return;
        }
        // 防御：无人类待行动且引擎无法推进，避免死循环；仍广播最新状态，保证前端不静默卡死
        await this.persist();
        this.broadcastState();
        return;
      }
    } finally {
      this.ticking = false;
    }
  }

  private armDeadline(): void {
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    const ms = this.engine.phaseDeadlineMs();
    this.deadlineAt = Date.now() + ms;
    this.deadlineTimer = setTimeout(() => {
      this.deadlineTimer = null;
      this.deadlineAt = null;
      // 超时托管：替未行动的人类玩家自动决策
      for (const playerId of this.engine.pendingHumans()) {
        try {
          this.engine.autoAct(playerId);
        } catch {
          // 托管失败不阻塞流程
        }
      }
      void this.tick();
    }, ms);
    // timer 不阻塞进程退出
    if (typeof this.deadlineTimer.unref === 'function') this.deadlineTimer.unref();
  }

  async persist(): Promise<void> {
    try {
      await prisma.room.update({
        where: { id: this.roomId },
        data: { gameState: this.engine.getState() as object },
      });
    } catch (error) {
      // 持久化失败不中断游戏，记录日志即可
      console.error('[game-director] persist failed', error);
    }
  }

  private broadcastState(): void {
    const state = this.engine.getState() as { phase?: string; round?: number };
    roomGateway.broadcast(this.roomId, {
      type: 'game_state_updated',
      payload: {
        phase: state.phase ?? '',
        round: state.round ?? 0,
        deadline: this.deadlineAt,
      },
    });
  }

  /** 结束：结算胜负 + 写回 gameData + 广播 */
  private async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.cleanup();

    const results = this.engine.getResults() ?? {};
    try {
      const state = this.engine.getState() as { players?: { playerId: string; isAlive?: boolean }[] };
      const aliveById = new Map((state.players ?? []).map((p) => [p.playerId, p.isAlive ?? true]));
      for (const player of this.players) {
        const result = results[player.playerId];
        await prisma.gamePlayer.update({
          where: { id: player.playerId },
          data: {
            isAlive: aliveById.get(player.playerId) ?? true,
            gameData: {
              gameRole: result?.role ?? '',
              won: result?.won ?? null,
            } as object,
          },
        });
      }
      await prisma.room.update({
        where: { id: this.roomId },
        data: { gameStatus: 'finished', gameState: this.engine.getState() as object },
      });
    } catch (error) {
      console.error('[game-director] finish failed', error);
    }

    roomGateway.broadcast(this.roomId, {
      type: 'game_game_ended',
      payload: { winner: (this.engine.getState() as { winner?: string }).winner ?? null },
    });
    GameDirector.active.delete(this.roomId);
  }

  /** 开局：把角色写进 gameData（对局中接口不回传，防作弊） */
  async writeStartData(): Promise<void> {
    const roles = this.engine.getRoles();
    for (const player of this.players) {
      await prisma.gamePlayer.update({
        where: { id: player.playerId },
        data: { gameData: { gameRole: roles[player.playerId] ?? '' } as object },
      });
    }
  }
}

function buildEngine(
  gameType: GameTypeStr,
  players: DirectorPlayerRow[],
  state: Record<string, unknown> | undefined,
  judgeOptions?: JudgeOptions,
): BaseGameEngine {
  const speechProvider = resolveGameSpeechProvider();
  const infos: GamePlayerInfo[] = players.map((p) => ({
    playerId: p.id,
    nickname: p.nickname,
    isAi: p.role === 'ai',
    userId: p.userId,
  }));
  switch (gameType) {
    case 'werewolf':
      return new WerewolfGame(infos, state, {
        judgeMode: judgeOptions?.judgeMode ?? null,
        judgePlayerId: judgeOptions?.judgePlayerId ?? null,
        speechProvider: speechProvider ?? undefined,
      });
    case 'who_is_the_thief':
      return new ThiefGame(infos, state, { speechProvider: speechProvider ?? undefined });
    case 'murder_mystery':
      return new MysteryGame(infos, state, { speechProvider: speechProvider ?? undefined });
    case 'who_is_undercover':
      return new UndercoverGame(infos, state, { speechProvider: speechProvider ?? undefined });
    default:
      throw new GameError('invalid_game_type', `未知游戏类型：${gameType}`);
  }
}
