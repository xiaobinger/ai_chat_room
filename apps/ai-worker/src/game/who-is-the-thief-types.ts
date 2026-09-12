/** 谁是凶手游戏类型定义（v2：人类投票 + 侦探私密结果 + 视角净化） */

export type ThiefPhase = 'investigation' | 'voting' | 'result';

export type ThiefRole = 'thief' | 'detective' | 'citizen' | 'master_thief' | 'accomplice' | 'witness';

export type ThiefPersona = '冷静观察型' | '强势带队型' | '圆滑周旋型' | '直觉冲票型';

export interface ThiefPlayerState {
  playerId: string;
  nickname: string;
  role: ThiefRole;
  persona: ThiefPersona;
  isAlive: boolean;
  /** 本轮是否已发言 */
  hasSpoken: boolean;
  /** 侦探本轮是否已调查 */
  hasInvestigated: boolean;
  /** 累计嫌疑（被投票 + 被嫁祸） */
  suspicion: number;
  /** 小偷是否已嫁祸（整局一次） */
  hasFramed: boolean;
  /** 目击者是否已揭示线索（整局一次） */
  hasRevealedClue: boolean;
  /** 音色档案（用于前端 TTS 音色差异化） */
  voiceProfile?: {
    gender?: 'male' | 'female' | 'unknown';
    age?: number;
    height?: number;
    weight?: number;
    personality?: string;
  };
}

export interface ThiefSpeech {
  round: number;
  playerId: string;
  nickname: string;
  content: string;
}

export interface ThiefPublicNote {
  round: number;
  content: string;
}

export interface ThiefGameEvent {
  id: string;
  round: number;
  phase: ThiefPhase;
  type: 'phase_change' | 'player_action' | 'clue_found' | 'vote_result' | 'game_start' | 'game_end' | 'special_event';
  actorName?: string;
  targetName?: string;
  content: string;
  timestamp: number;
}

export interface ThiefGameState {
  format: 2;
  phase: ThiefPhase;
  round: number;
  players: ThiefPlayerState[];
  /** 小偷阵营（结束前对玩家隐藏） */
  thiefTeamIds: string[];
  /** 公开发言记录 */
  speechLog: ThiefSpeech[];
  /** 私密信息（侦探查验结果等，按玩家隔离） */
  privateNotes: Record<string, string[]>;
  /** 已公开的线索 */
  revealedClues: string[];
  votes: Record<string, string>;
  voteStatus: Record<string, 'voted' | 'abstained'>;
  accusedPlayerId?: string;
  winner?: 'thief' | 'citizen';
  stolenItem: string;
  crimeScene: string;
  /** 本局全部线索（未公开前对玩家不可见） */
  clues: string[];
  masterThiefEscapeUsed: boolean;
  /** 连续平票轮数（达到 3 次按累计嫌疑度强制出局，防止对局永不收敛） */
  consecutiveTies?: number;
  /** 全员可见的局势记忆 */
  publicNotes: ThiefPublicNote[];
  /** 正在调用大模型生成发言的 AI 玩家（前端显示“正在输入”过渡） */
  typingPlayerId?: string | null;
  events: ThiefGameEvent[];
}

export const THIEF_ROLE_LABELS: Record<ThiefRole, string> = {
  thief: '小偷',
  detective: '侦探',
  citizen: '普通市民',
  master_thief: '神偷',
  accomplice: '同伙',
  witness: '目击者',
};

export const THIEF_ROLE_DESCRIPTIONS: Record<ThiefRole, string> = {
  thief: '你是小偷！隐藏自己的身份，避免被投票出局。可以嫁祸他人一次（悄悄增加其嫌疑）。',
  detective: '你是侦探！每轮可以调查一名玩家，确认其是否为小偷（结果只有你知道）。带领市民找出真凶！',
  citizen: '你是普通市民！通过观察和推理，找出真正的小偷并投票将其出局。',
  master_thief: '你是神偷！即使被投票出局，也可以使用金蝉脱壳逃脱一次。',
  accomplice: '你是同伙！帮助小偷隐藏身份，你们共同获胜。',
  witness: '你是目击者！你知道一条关于案件的线索。可以公开一条线索帮助市民（整局一次）。',
};

export const THIEF_PERSONA_DESCRIPTIONS: Record<ThiefPersona, string> = {
  冷静观察型: '更喜欢先听信息、抓矛盾，再慢慢收紧怀疑范围。',
  强势带队型: '喜欢快速立焦点、主动带票，推动全场节奏。',
  圆滑周旋型: '说话留余地，善于顺着别人的观点补刀或打圆场。',
  直觉冲票型: '更相信第一反应和现场气氛，容易直接点名质疑。',
};

// 失窃物品池
export const STOLEN_ITEMS = [
  '钻石项链', '古董花瓶', '名画《星空》', '皇室皇冠', '神秘宝石',
  '珍贵手稿', '黄金雕像', '古代玉佩', '稀世珍珠', '传奇宝剑',
];

// 案发现场池
export const CRIME_SCENES = [
  '博物馆的深夜，警报声打破了寂静...',
  '豪华晚宴上，宾客们惊恐地发现宝物不翼而飞...',
  '拍卖行的保险库被悄然打开，只留下神秘的字条...',
  '私人收藏家的宅邸，监控突然失灵了十分钟...',
  '展览馆的闭馆时间，一个黑影闪过展厅...',
];

// 线索池
export const CLUES = [
  '现场发现了一枚奇怪的指纹...',
  '监控拍到了一个模糊的背影...',
  '有人闻到了一股特殊的香水味...',
  '地上留下了一小片特殊的布料...',
  '窗户上有被撬动的痕迹...',
  '现场发现了一根不属于任何人的头发...',
  '有人听到了一声奇怪的响动...',
  '门锁没有被破坏的痕迹，说明有内鬼...',
];

// 彩蛋事件
export const SPECIAL_EVENTS = {
  plot_twist: {
    label: '剧情反转',
    description: '一个神秘人物突然出现，声称知道真相...',
  },
  hidden_evidence: {
    label: '隐藏证据',
    description: '在角落发现了一个被遗忘的证据！',
  },
  false_alibi: {
    label: '虚假不在场证明',
    description: '某人的不在场证明被戳穿了！',
  },
  secret_letter: {
    label: '密信',
    description: '一封匿名信揭示了惊人的秘密...',
  },
  unexpected_witness: {
    label: '意外目击者',
    description: '一个之前被忽略的目击者出现了！',
  },
};
