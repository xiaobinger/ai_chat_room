/** 游戏引擎统一错误：Director 捕获后转成 400 响应 */
export class GameError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GameError';
  }
}

/** 引擎通用玩家信息 */
export interface GamePlayerInfo {
  playerId: string;
  nickname: string;
  isAi: boolean;
  userId?: string | null;
}

/** 引擎通用动作（Director 校验玩家身份后转发） */
export interface EngineAction {
  type: string;
  playerId: string;
  targetId?: string;
  content?: string;
  clueId?: string;
}
