/** 狼人杀游戏类型定义 */

export type GamePhase = 'night' | 'day' | 'vote' | 'finished';

export type WerewolfRole = 'werewolf' | 'villager' | 'seer' | 'witch' | 'hunter';

export interface PlayerState {
  playerId: string;
  nickname: string;
  role: WerewolfRole;
  isAlive: boolean;
  isProtected?: boolean;
}

export interface GameLogEntry {
  id: string;
  round: number;
  phase: GamePhase;
  type: 'phase_change' | 'player_action' | 'player_death' | 'vote_result' | 'game_start' | 'game_end';
  actorId?: string;
  actorName?: string;
  targetId?: string;
  targetName?: string;
  content: string;
  timestamp: number;
  role?: WerewolfRole;
}

export interface GameState {
  phase: GamePhase;
  round: number;
  players: PlayerState[];
  werewolfTarget?: string;
  seerTarget?: string;
  seerResult?: { target: string; isWerewolf: boolean };
  witchAction?: { type: 'save' | 'poison'; target?: string };
  dayMessages: DayMessage[];
  votes: Record<string, string>;
  deadTonight: string[];
  deadToday: string[];
  winner?: 'werewolf' | 'villager';
  hunterCanShoot?: boolean;
  events: GameLogEntry[];
}

export interface DayMessage {
  playerId: string;
  nickname: string;
  content: string;
  timestamp: number;
}

export interface GameAction {
  type: 'werewolf_kill' | 'seer_check' | 'witch_save' | 'witch_poison' | 'day_speak' | 'vote' | 'hunter_shoot';
  playerId: string;
  targetId?: string;
  content?: string;
}

export const ROLE_LABELS: Record<WerewolfRole, string> = {
  werewolf: '狼人',
  villager: '村民',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
};

export const ROLE_DESCRIPTIONS: Record<WerewolfRole, string> = {
  werewolf: '每晚可以杀死一名玩家。目标是杀光所有村民。',
  villager: '没有特殊能力。通过投票找出狼人。',
  seer: '每晚可以查验一名玩家的身份。',
  witch: '拥有一瓶解药和一瓶毒药。解药可以救活当晚被杀的玩家，毒药可以毒死一名玩家。每种药整局只能使用一次。',
  hunter: '死亡时（被投票或被狼人杀死）可以开枪带走一名玩家。',
};
