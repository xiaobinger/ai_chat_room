/** 狼人杀游戏类型定义（v2：整局限药 + 多狼投票 + 猎人开枪 + 阶段状态追踪） */

export type GamePhase = 'night' | 'day' | 'vote' | 'final_speech' | 'finished';

export type WerewolfRole = 'werewolf' | 'villager' | 'seer' | 'witch' | 'hunter';

export interface PlayerState {
  playerId: string;
  nickname: string;
  role: WerewolfRole;
  isAlive: boolean;
  /** 累计被投票数（AI 启发式用，不泄露身份） */
  suspicion: number;
}

export interface GameLogEntry {
  id: string;
  round: number;
  phase: GamePhase;
  type: 'phase_change' | 'player_action' | 'player_death' | 'vote_result' | 'game_start' | 'game_end' | 'judge_speak' | 'final_speech';
  actorId?: string;
  actorName?: string;
  targetId?: string;
  targetName?: string;
  content: string;
  timestamp: number;
  /** 仅复盘用；玩家视角会剥离 */
  role?: WerewolfRole;
}

export interface SeerCheckResult {
  round: number;
  target: string;
  targetName: string;
  isWerewolf: boolean;
}

export interface DayMessage {
  playerId: string;
  nickname: string;
  content: string;
  timestamp: number;
}

export interface GameState {
  /** 状态结构版本；旧数据（无此字段）不做重启恢复 */
  format: 2;
  phase: GamePhase;
  round: number;
  players: PlayerState[];
  /** 夜晚：狼人击杀投票（狼人 playerId -> 目标 playerId） */
  wolfVotes: Record<string, string>;
  /** 夜晚：本轮已查验的目标（防重复查验） */
  seerCheckedTonight: string[];
  /** 预言家查验历史（仅预言家视角可见） */
  seerChecks: SeerCheckResult[];
  /** 女巫药剂：整局各一次 */
  witchPotions: { save: boolean; poison: boolean };
  /** 女巫今晚决策 */
  witchTonight?: 'save' | 'poison' | 'pass';
  /** 女巫毒杀目标（今晚） */
  witchPoisonTarget?: string;
  /** 狼刀目标（夜晚结算前，仅女巫视角可见） */
  nightVictim?: string;
  /** 白天发言状态 */
  speechStatus: Record<string, 'spoken' | 'skipped'>;
  dayMessages: DayMessage[];
  /** 投票状态 */
  voteStatus: Record<string, 'voted' | 'abstained'>;
  votes: Record<string, string>;
  /** 待开枪猎人（白天待结算） */
  pendingHunter?: string;
  /** 今晚死亡（结算后） */
  deadTonight: string[];
  /** 今天放逐/开枪死亡 */
  deadToday: string[];
  /** 玩家临终遗言：playerId -> 遗言内容 */
  finalSpeeches: Record<string, string>;
  /** 临终遗言阶段：已发言/已跳过的死亡玩家 */
  finalSpeechStatus: Record<string, 'spoken' | 'skipped'>;
  /** 法官模式：owner=房主担任法官；ai=AI法官；null=无法官（兼容旧存档） */
  judgeMode?: 'owner' | 'ai' | null;
  /** 法官的 playerId（owner 模式下为房主 gamePlayerId；ai 模式下为 AI法官 gamePlayerId） */
  judgePlayerId?: string | null;
  winner?: 'werewolf' | 'villager';
  events: GameLogEntry[];
}

export type GameActionType =
  | 'werewolf_kill'
  | 'seer_check'
  | 'witch_save'
  | 'witch_poison'
  | 'witch_pass'
  | 'day_speak'
  | 'day_skip'
  | 'vote'
  | 'vote_abstain'
  | 'hunter_shoot'
  | 'final_speech'
  | 'final_speech_skip'
  | 'judge_speak';

export const ROLE_LABELS: Record<WerewolfRole, string> = {
  werewolf: '狼人',
  villager: '村民',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
};

export const ROLE_DESCRIPTIONS: Record<WerewolfRole, string> = {
  werewolf: '每晚与同伴共同选择一名玩家击杀。目标是消灭所有好人。',
  villager: '没有特殊能力。通过白天发言和投票找出狼人。',
  seer: '每晚可以查验一名玩家的阵营。用金水和查杀带领好人。',
  witch: '拥有一瓶解药和一瓶毒药，整局各只能使用一次。解药可以救活当晚被刀的玩家，毒药可以毒死一名玩家。',
  hunter: '被投票出局或被狼人杀死时，可以开枪带走一名玩家（被毒死无法开枪）。',
};
