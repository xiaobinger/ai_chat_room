/** 剧本杀游戏类型定义 */

export type MysteryPhase = 'introduction' | 'investigation' | 'discussion' | 'voting' | 'reveal';

export interface CharacterCard {
  id: string;
  name: string;
  role: string;           // 角色职业/身份
  personality: string;    // 性格特点
  backstory: string;     // 背景故事
  secret: string;        // 秘密（仅自己可见）
  objective: string;     // 游戏目标
  isMurderer: boolean;   // 是否为凶手
  alibi: string;         // 不在场证明
  relationshipToVictim: string;  // 与受害者的关系
}

export interface ClueCard {
  id: string;
  name: string;
  description: string;   // 线索描述
  location: string;      // 发现地点
  revealsInfo: string;   // 揭示的信息
  isKey: boolean;        // 是否为关键线索
  discoveredBy?: string; // 发现者 playerId
}

export interface MysteryPlayerState {
  playerId: string;
  nickname: string;
  character: CharacterCard;
  isAlive: boolean;
  hasSpoken: boolean;
  hasSearched: boolean;
  votes: number;
  suspicionLevel: number;  // 嫌疑值（越高越可疑）
}

export interface MysteryGameState {
  format: 2;
  phase: MysteryPhase;
  round: number;
  players: MysteryPlayerState[];
  victim: string;                    // 受害者
  crimeScene: string;                // 案发现场
  murderWeapon: string;              // 凶器
  murdererId: string;                // 凶手 playerId
  clues: ClueCard[];
  discoveredClues: string[];         // 已发现的线索 id
  discussionLog: DiscussionEntry[];
  votes: Record<string, string>;      // voterId -> targetId
  voteStatus: Record<string, 'voted' | 'abstained'>;
  accusedMurdererId?: string;         // 被指控的凶手
  winner?: 'murderer' | 'detectives';
  events: MysteryGameEvent[];
}

export interface DiscussionEntry {
  playerId: string;
  playerName: string;
  characterName: string;
  content: string;
  timestamp: number;
  type: 'statement' | 'question' | 'accusation' | 'defense';
}

export interface MysteryGameEvent {
  id: string;
  round: number;
  phase: MysteryPhase;
  type: 'phase_change' | 'clue_discovered' | 'player_action' | 'vote_result' | 'game_start' | 'game_end' | 'roleplay';
  actorName?: string;
  characterName?: string;
  content: string;
  timestamp: number;
}

// 剧本池
export const MYSTERY_SCENARIOS = [
  {
    title: '古宅疑云',
    victim: '陈老爷',
    crimeScene: '陈家古宅的书房，门窗紧锁，陈老爷倒在血泊中...',
    murderWeapon: '古董烛台',
    location: '陈家古宅',
  },
  {
    title: '游轮迷案',
    victim: '威廉船长',
    crimeScene: '豪华游轮的船长室，船长被发现死在办公桌前...',
    murderWeapon: '拆信刀',
    location: '玛丽皇后号游轮',
  },
  {
    title: '剧院幽灵',
    victim: '林首席',
    crimeScene: '国家大剧院的后台化妆间，林首席倒在镜子前...',
    murderWeapon: '化妆镜碎片',
    location: '国家大剧院',
  },
  {
    title: '庄园晚宴',
    victim: '詹姆斯爵士',
    crimeScene: '詹姆斯爵士的庄园宴会厅，爵士在众目睽睽之下倒地...',
    murderWeapon: '毒酒',
    location: '玫瑰庄园',
  },
];

// 角色卡池
export const CHARACTER_POOL: Omit<CharacterCard, 'id' | 'isMurderer'>[] = [
  {
    name: '张明远',
    role: '管家',
    personality: '忠诚、谨慎、观察力敏锐',
    backstory: '在陈家服务了30年，对古宅的一草一木都了如指掌。',
    secret: '当晚看到有人从书房窗户离开，但看不清面容。',
    objective: '保护家族的秘密，同时找出真凶。',
    alibi: '案发时在一楼准备茶水。',
    relationshipToVictim: '主仆关系，忠心耿耿。',
  },
  {
    name: '李婉清',
    role: '女儿',
    personality: '聪慧、敏感、略带忧郁',
    backstory: '陈老爷的独生女，刚从国外留学归来。',
    secret: '知道父亲有一笔巨额遗产，自己是唯一继承人。',
    objective: '查明父亲死因，继承遗产。',
    alibi: '案发时在二楼卧室看书。',
    relationshipToVictim: '父女关系，近期因婚事有争执。',
  },
  {
    name: '王德明',
    role: '律师',
    personality: '精明、冷静、善于分析',
    backstory: '陈老爷的私人律师，负责处理家族法律事务。',
    secret: '掌握着陈老爷最新遗嘱的内容。',
    objective: '确保遗嘱按照委托人意愿执行。',
    alibi: '案发时在客厅与其他人聊天。',
    relationshipToVictim: '客户与律师，合作多年。',
  },
  {
    name: '赵小蝶',
    role: '女仆',
    personality: '机灵、胆小、善良',
    backstory: '在陈家工作了两年的女仆，主要负责照顾陈老爷起居。',
    secret: '案发前听到书房有争吵声。',
    objective: '洗清自己的嫌疑，找出真凶。',
    alibi: '案发时在厨房准备晚餐。',
    relationshipToVictim: '主仆关系，陈老爷对她很和善。',
  },
  {
    name: '孙伯年',
    role: '老友',
    personality: '豪爽、直率、重情义',
    backstory: '陈老爷的大学同学，两人有40年的交情。',
    secret: '欠了陈老爷一大笔钱，最近刚还清。',
    objective: '为老友找出真凶，报答恩情。',
    alibi: '案发时在花园散步。',
    relationshipToVictim: '挚友，曾有过命的交情。',
  },
  {
    name: '钱美琳',
    role: '侄女',
    personality: '热情、大方、有些爱慕虚荣',
    backstory: '陈老爷哥哥的女儿，最近从外地来投奔叔叔。',
    secret: '暗恋着一个人，案发前曾去找他。',
    objective: '在家族中站稳脚跟，获得叔叔认可。',
    alibi: '案发时在房间休息。',
    relationshipToVictim: '叔侄关系，来投奔叔叔。',
  },
  {
    name: '周大夫',
    role: '家庭医生',
    personality: '沉稳、细心、医术高明',
    backstory: '陈老爷的私人医生，负责他的健康。',
    secret: '知道陈老爷身患绝症，时日无多。',
    objective: '尊重死者，找出真相。',
    alibi: '案发时在配药室准备药物。',
    relationshipToVictim: '医患关系，多年老友。',
  },
  {
    name: '吴探长',
    role: '警探',
    personality: '正义、执着、洞察力强',
    backstory: '接到报案后第一时间赶到现场的警探。',
    secret: '曾经处理过类似案件，有线索但未公开。',
    objective: '破案，将凶手绳之以法。',
    alibi: '案发后才到达现场。',
    relationshipToVictim: '负责调查此案的警探。',
  },
];

// 线索池
export const CLUE_POOL: Omit<ClueCard, 'id' | 'discoveredBy'>[] = [
  {
    name: '带血的烛台',
    description: '书桌上沾满血迹的烛台，是凶器。',
    location: '书房书桌',
    revealsInfo: '凶手使用烛台击打受害者头部致死。',
    isKey: true,
  },
  {
    name: '撕碎的信件',
    description: '垃圾桶里被撕碎的信件，拼凑后内容是关于...',
    location: '书房垃圾桶',
    revealsInfo: '死者生前曾与某人发生激烈争执。',
    isKey: false,
  },
  {
    name: '窗外的脚印',
    description: '书房窗户外的泥地上有清晰的脚印。',
    location: '书房窗外花园',
    revealsInfo: '有人曾从窗户进出书房。',
    isKey: true,
  },
  {
    name: '失踪的钥匙',
    description: '书房的钥匙不见了，门窗原本从内部反锁。',
    location: '书房门锁',
    revealsInfo: '凶手可能持有备用钥匙或从窗户离开。',
    isKey: true,
  },
  {
    name: '半杯残茶',
    description: '书房茶几上的半杯茶，检测出有药物成分。',
    location: '书房茶几',
    revealsInfo: '受害者生前可能被下药，失去了反抗能力。',
    isKey: true,
  },
  {
    name: '地板上的纽扣',
    description: '书房地板上发现一枚精致的纽扣。',
    location: '书房地板',
    revealsInfo: '凶手可能在与受害者争执时扯落了纽扣。',
    isKey: false,
  },
  {
    name: '监控录像',
    description: '走廊监控显示案发时间段有人经过。',
    location: '走廊监控室',
    revealsInfo: '可以看到谁进出过书房附近。',
    isKey: true,
  },
  {
    name: '日记残页',
    description: '死者日记的最后一页，写着神秘的内容。',
    location: '卧室抽屉',
    revealsInfo: '死者预感到自己有危险，记录了可疑人物。',
    isKey: false,
  },
];
