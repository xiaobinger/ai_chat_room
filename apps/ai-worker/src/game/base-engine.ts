import type { EngineAction, GamePlayerInfo } from './errors';

/**
 * 游戏引擎统一接口。
 *
 * 引擎持有完整状态并驱动"阶段机"：
 * - step()：推进一原子步（AI 行动或阶段结算），返回是否还能继续推进。
 *   Director 反复调用直到返回 false（等待人类或游戏结束）。
 * - pendingHumans()：当前阶段仍需行动的人类玩家。
 * - phaseDeadlineMs()：当前阶段的人类行动超时；到期后 Director 对每个
 *   未行动玩家调用 autoAct() 托管，保证游戏永不卡死。
 * - handleAction()：处理人类动作，校验失败抛 GameError。
 * - getView()：按玩家过滤的视角（隐藏他人身份，防作弊）。
 */
export abstract class BaseGameEngine {
  constructor(protected readonly players: GamePlayerInfo[]) {}

  abstract step(): boolean;
  abstract pendingHumans(): string[];
  abstract phaseDeadlineMs(): number;
  abstract handleAction(action: EngineAction): void;
  abstract autoAct(playerId: string): void;
  abstract getView(playerId: string | null, isJudge?: boolean): Record<string, unknown>;
  abstract getState(): Record<string, unknown>;
  abstract isFinished(): boolean;

  /** 游戏结束后按玩家结算：playerId -> { won, role }；未结束返回 null */
  abstract getResults(): Record<string, { won: boolean; role: string }> | null;

  /** 开局时的角色标签（写入 gameData 供复盘/统计；游戏中不对外暴露） */
  abstract getRoles(): Record<string, string>;

  protected isAi(playerId: string): boolean {
    return this.players.find((p) => p.playerId === playerId)?.isAi ?? false;
  }
}
