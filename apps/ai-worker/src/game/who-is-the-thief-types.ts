/** 谁是凶手游戏类型定义 */

export type ThiefPhase = 'investigation' | 'voting' | 'accusation' | 'result';

export type ThiefRole = 'thief' | 'detective' | 'citizen' | 'master_thief' | 'accomplice' | 'witness';

export interface ThiefPlayerState {
  playerId: string;
  nickname: string;
  role: ThiefRole;
  isAlive: boolean;
  hasSpoken: boolean;           // 本轮是否已发言
  hasInvestigated: boolean;     // 侦探本轮是否已调查
  votes: number;                // 获得票数
  isProtected: boolean;         // 是否被保护（目击者能力）
  hasFramed: boolean;           // 是否已嫁祸他人
  hasRevealedClue: boolean;     // 目击者是否已揭示线索
}

export interface InvestigationAction {
  type: 'question' | 'answer' | 'investigate' | 'frame' | 'reveal_clue';
  actorId: string;
  targetId?: string;
  content: string;
  result?: string;
}

export interface ThiefGameState {
  phase: ThiefPhase;
  round: number;
  players: ThiefPlayerState[];
  thiefId: string;                        // 小偷 id
  detectiveId: string;                    // 侦探 id
  actions: InvestigationAction[];
  votes: Record<string, string>;           // voterId -> targetId
  accusedPlayerId?: string;               // 被指控的玩家
  winner?: 'thief' | 'citizen';
  stolenItem: string;                     // 失窃物品
  crimeScene: string;                     // 案发现场描述
  clues: string[];                        // 线索列表
  events: ThiefGameEvent[];
  masterThiefEscapeUsed: boolean;         // 神偷是否已使用金蝉脱壳
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
  role?: ThiefRole;
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
  thief: '你是小偷！隐藏自己的身份，避免被投票出局。可以嫁祸他人一次。',
  detective: '你是侦探！每轮可以调查一名玩家，确认其是否为小偷偷。带领市民找出真凶！',
  citizen: '你是普通市民！通过观察和推理，找出真正的小偷并投票将其出局。',
  master_thief: '你是神偷！即使被投票出局，也可以使用金蝉脱壳逃脱一次。',
  accomplice: '你是同伙！帮助小偷隐藏身份，你们共同获胜。',
  witness: '你是目击者！你知道一条关于小偷的线索。可以揭示线索帮助市民。',
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
