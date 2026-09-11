/** 剧本杀游戏类型定义 */

export type MysteryPhase = 'introduction' | 'investigation' | 'discussion' | 'accusation' | 'voting' | 'reveal';

/**
 * 剧本杀 ≠ 找凶手。每个角色有自己的秘密任务，完成任务即获胜。
 * 任务类型：隐藏身份 / 拿到线索 / 指认某人 / 保护某人 / 误导他人 ...
 */
export interface PersonalObjective {
  type: 'find_truth' | 'hide_secret' | 'steal_item' | 'protect_someone' | 'frame_someone' | 'accumulate_votes' | 'escape';
  description: string;         // 任务描述（对玩家可见）
  targetId?: string;           // 任务目标玩家（如：保护/陷害）
  targetClueId?: string;       // 需要拿到的线索
  reward: string;              // 完成后获得什么
  isComplete: boolean;         // 是否已完成
}

/** 角色之间的关系声明（可能是真的，也可能是假的） */
export interface RelationshipClaim {
  targetName: string;          // 声称与谁有关系
  relationship: string;        // 声称的关系（如：恋人、兄弟、仇人）
  isTrue: boolean;             // 这段关系是真的还是编造的
}

export interface CharacterCard {
  id: string;
  name: string;
  role: string;           // 角色职业/身份
  personality: string;    // 性格特点
  backstory: string;     // 背景故事
  secret: string;        // 秘密（仅自己可见）
  isMurderer: boolean;   // 是否为凶手
  isPolice?: boolean;    // 是否为本案负责调查的警察/侦探
  isCorrupt?: boolean;   // 警察是否与凶手勾结（仅 isPolice 时有意义）
  alibi: string;         // 不在场证明
  relationshipToVictim: string;  // 与受害者的真实关系
  claimedRelationships?: RelationshipClaim[];  // 自我介绍时声称的关系（可真可假）
  objectives: PersonalObjective[];  // 个人任务（完成任意一个即算个人胜利）
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
  completedObjectives: string[];  // 已完成的任务描述
}

export interface PlayerResult {
  playerId: string;
  nickname: string;
  characterName: string;
  wasMurderer: boolean;
  objectives: { description: string; completed: boolean }[];
  completedCount: number;
  isWinner: boolean;
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
  policeId?: string;                 // 负责调查的警察 playerId
  clues: ClueCard[];
  discoveredClues: string[];         // 已发现的线索 id
  discussionLog: DiscussionEntry[];
  /** 正在调用大模型生成发言的 AI 玩家（前端显示“正在输入”过渡） */
  typingPlayerId?: string | null;
  votes: Record<string, string>;      // voterId -> targetId
  voteStatus: Record<string, 'voted' | 'abstained'>;
  /** 连续平票轮数（达到 3 次按累计嫌疑度强制指认，防止对局永不收敛） */
  consecutiveTies?: number;
  accusedMurdererId?: string;         // 被指控的凶手
  winner?: 'murderer' | 'detectives';
  events: MysteryGameEvent[];
  scenarioTitle?: string;            // 剧本标题（用于 AI 发言引用）
  /** 侦探/警察的观察记录 */
  observations: DetectiveObservation[];
  /** 悄悄话记录 */
  secretChats: SecretConversation[];
  /** 全员可见的局势记忆 */
  publicNotes: { round: number; content: string }[];
  /** 凶手独白（reveal 阶段生成） */
  monologue?: MurdererMonologue;
  /** 详细复盘（reveal 阶段生成） */
  replay?: DetailedReplay;
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
  type: 'phase_change' | 'clue_discovered' | 'player_action' | 'vote_result' | 'game_start' | 'game_end' | 'roleplay' | 'observation' | 'secret_chat' | 'monologue';
  actorName?: string;
  characterName?: string;
  content: string;
  timestamp: number;
  /** 仅特定角色可见（如侦探调查结果仅侦探可见） */
  visibleTo?: string[];
}

/** 侦探/警察的特殊观察能力：观察其他玩家的行为、小动作 */
export interface DetectiveObservation {
  id: string;
  round: number;
  observerId: string;       // 侦探 playerId
  targetId: string;         // 被观察玩家 playerId
  targetName: string;
  /** 观察到的行为/小动作 */
  behavior: string;
  /** 侦探的推理分析 */
  deduction: string;
  /** 是否有可疑迹象 */
  suspicious: boolean;
  /** 嫌疑值变化（正=增加，负=减少） */
  suspicionDelta: number;
  timestamp: number;
}

/** 角色可被观察到的行为（AI 自动生成 + 人类玩家也可能有） */
export interface ObservableBehavior {
  /** 行为描述（如："频繁看手表"、"手在发抖"、"偷偷和某人交换眼神"） */
  action: string;
  /** 这个行为暗示什么（如："可能在等某人"、"很紧张"、"他们认识"） */
  implication: string;
  /** 观察到这个行为的玩家 */
  observedBy: string[];
}

/** 悄悄话：两个角色之间的私下交流 */
export interface SecretConversation {
  id: string;
  round: number;
  participantA: string;     // 参与者A playerId
  participantB: string;     // 参与者B playerId
  messages: {
    speaker: string;        // 昵称
    content: string;
  }[];
  /** 交流内容概述（复盘可见） */
  summary: string;
  /** 是否包含关键信息 */
  isKey: boolean;
}

/** 动机分析：每个角色为什么可能是凶手 */
export interface MotiveAnalysis {
  playerId: string;
  characterName: string;
  nickname: string;
  /** 表面动机（所有人都知道的） */
  surfaceMotive: string;
  /** 隐藏动机（只有自己知道） */
  hiddenMotive?: string;
  /** 侦探推理出的深层动机 */
  deducedMotive?: string;
  /** 动机强度 1-5（5=最强动机） */
  strength: number;
}

/** 凶手独白：真相大白后凶手讲述整个作案过程 */
export interface MurdererMonologue {
  /** 作案动机 */
  motive: string;
  /** 精心策划的过程 */
  planning: string;
  /** 作案经过 */
  execution: string;
  /** 事后处理 */
  aftermath: string;
  /** 对其他玩家说的话 */
  finalWords: string;
  /** 情感基调 */
  emotion: 'remorseful' | 'defiant' | 'calm' | 'bitter' | 'desperate';
}

/** 单个玩家的详细分析（复盘用） */
export interface PlayerAnalysis {
  playerId: string;
  nickname: string;
  characterName: string;
  characterRole: string;
  wasMurderer: boolean;
  wasPolice: boolean;
  wasCorrupt: boolean;
  /** 真实关系网 */
  realRelationships: string[];
  /** 声称的关系 vs 真实关系 */
  claimedVsReal: { claimed: string; real: string }[];
  /** 个人任务完成情况 */
  objectives: { description: string; completed: boolean }[];
  /** 关键发言摘录 */
  keyStatements: string[];
  /** 动机分析 */
  motive: MotiveAnalysis;
  /** 侦探观察记录（关于此玩家的） */
  observationsAbout: string[];
  /** 最终评价 */
  finalVerdict: string;
}

/** 超详细复盘数据 */
export interface DetailedReplay {
  /** 基本信息 */
  scenarioTitle: string;
  victim: string;
  crimeScene: string;
  murderWeapon: string;
  duration: string;

  /** 凶手信息 */
  murdererId: string;
  murdererName: string;
  murdererCharacter: string;
  murdererMonologue: MurdererMonologue;

  /** 案件真相 */
  truth: {
    motive: string;
    timeline: string[];
    method: string;
    keyEvidence: string[];
  };

  /** 所有玩家的详细分析 */
  playerAnalyses: PlayerAnalysis[];

  /** 侦探观察记录 */
  detectiveObservations: DetectiveObservation[];

  /** 悄悄话记录 */
  secretConversations: SecretConversation[];

  /** 所有关键线索及其含义 */
  clueAnalysis: {
    clue: ClueCard;
    significance: string;
    pointedTo: string;  // 指向谁
  }[];

  /** 游戏结果 */
  winner: string;
  correctAccusation: boolean;
}

/** 剧本模板：每个剧本自带专属角色和线索，确保情境一致 */
export interface MysteryScenario {
  title: string;
  victim: string;
  crimeScene: string;
  murderWeapon: string;
  location: string;
  /** 剧本简介，用于 AI 发言背景 */
  synopsis: string;
  characters: Omit<CharacterCard, 'id' | 'isMurderer'>[];
  clues: Omit<ClueCard, 'id' | 'discoveredBy'>[];
}

// 剧本池（每个剧本自带专属角色与线索，避免风格/情境错乱）
export const MYSTERY_SCENARIOS: MysteryScenario[] = [
  // ========== 剧本 1：古宅疑云 ==========
  {
    title: '古宅疑云',
    victim: '陈老爷',
    crimeScene: '陈家古宅的书房，门窗紧锁，陈老爷倒在血泊中，手里还攥着半张字条……',
    murderWeapon: '青铜烛台',
    location: '陈家古宅',
    synopsis: '民国年间，富商陈老爷在自己的书房遇害。门窗从内部反锁，凶器是书桌上的青铜烛台。当晚留宿古宅的六个人都有嫌疑。',
    characters: [
      {
        name: '张明远',
        role: '老管家',
        personality: '忠诚、谨慎、观察力敏锐',
        backstory: '在陈家服务了三十年，对古宅的一草一木都了如指掌，是陈老爷最信任的人。',
        secret: '案发前看到有人从书房窗户方向离开，但月光昏暗没看清面容。',
        objectives: [{ type: 'find_truth' as const, description: '保护陈家的声誉，找出真凶。', reward: '真相', isComplete: false }],
        alibi: '案发时在一楼储物间清点杂物，有出入记录为证。',
        relationshipToVictim: '主仆关系，忠心耿耿，情同手足。',
      },
      {
        name: '李婉清',
        role: '独生女',
        personality: '聪慧、敏感、略带忧郁',
        backstory: '陈老爷的独生女，刚从国外留学归来，因婚事与父亲争执过。',
        secret: '知道父亲刚修改了遗嘱，将大部分遗产留给了慈善机构。',
        objectives: [{ type: 'find_truth' as const, description: '查明父亲死因，维护自己应有的权益。', reward: '真相', isComplete: false }],
        alibi: '案发时在二楼卧室休息，女佣可以作证。',
        relationshipToVictim: '父女关系，近期因婚事和遗产有过激烈争执。',
      },
      {
        name: '王德明',
        role: '私人律师',
        personality: '精明、冷静、善于分析',
        backstory: '陈老爷的私人律师，负责处理家族法律事务，掌握最新遗嘱。',
        secret: '新遗嘱的受益人不是陈家人，而是一个神秘的"故人"。',
        objectives: [{ type: 'find_truth' as const, description: '确保遗嘱按委托人意愿执行，不卷入家族纷争。', reward: '真相', isComplete: false }],
        alibi: '案发时在客厅与其他客人聊天，多人可证。',
        relationshipToVictim: '客户与律师，合作超过十年。',
      },
      {
        name: '赵小蝶',
        role: '贴身女仆',
        personality: '机灵、胆小、善良',
        backstory: '在陈家工作两年，主要负责照顾陈老爷的起居饮食。',
        secret: '案发前曾听到书房传来争吵声，其中一人声音像小姐。',
        objectives: [{ type: 'find_truth' as const, description: '洗清自己的嫌疑，保护无辜的人。', reward: '真相', isComplete: false }],
        alibi: '案发时在厨房准备晚餐，厨师可作证。',
        relationshipToVictim: '主仆关系，陈老爷对她颇为照顾。',
      },
      {
        name: '孙伯年',
        role: '世交老友',
        personality: '豪爽、直率、重情义',
        backstory: '陈老爷的大学同学，两人有四十年的交情，最近生意周转困难。',
        secret: '欠了陈老爷一大笔钱，借条上写着若到期不还将以房产抵债。',
        objectives: [{ type: 'find_truth' as const, description: '为老友找出真凶，同时不想让债务的事闹大。', reward: '真相', isComplete: false }],
        alibi: '案发时在花园散步，没人陪同。',
        relationshipToVictim: '挚友，曾有过命的交情，但近期有经济纠纷。',
      },
      {
        name: '周大夫',
        role: '家庭医生',
        personality: '沉稳、细心、医术高明',
        backstory: '陈老爷的私人医生，负责他的健康，每周上门两次。',
        secret: '知道陈老爷身患绝症，最多还能活三个月，且最近在加大止痛药剂量。',
        objectives: [{ type: 'find_truth' as const, description: '尊重死者，找出真相，不泄露病人隐私。', reward: '真相', isComplete: false }],
        alibi: '案发时在配药室整理药箱。',
        relationshipToVictim: '医患关系，亦是多年老友。',
      },
      {
        name: '李探长',
        role: '警探',
        personality: '冷峻、敏锐、直觉惊人',
        backstory: '当地警局的资深探长，接到报案后第一时间赶到古宅，负责本案调查。',
        secret: '他曾因受贿被内部调查过，一直想立功洗白自己。',
        objectives: [{ type: 'find_truth' as const, description: '破案立功，恢复自己的名誉。', reward: '真相', isComplete: false }],
        alibi: '案发后才到达现场，由警员陪同。',
        relationshipToVictim: '负责调查此案的警探，与死者素不相识。',
      },
    ],
    clues: [
      {
        name: '青铜烛台',
        description: '书桌上沾满血迹的青铜烛台，是凶器。',
        location: '书房书桌',
        revealsInfo: '凶手使用烛台击打陈老爷头部致死。',
        isKey: true,
      },
      {
        name: '半张字条',
        description: '陈老爷手中攥着的半张字条，上面写着"……遗产归……"。',
        location: '书房书桌',
        revealsInfo: '陈老爷死前正在修改遗嘱，且新遗嘱涉及遗产归属。',
        isKey: true,
      },
      {
        name: '窗外的泥脚印',
        description: '书房窗外泥地上有一串清晰的脚印，鞋码较大。',
        location: '书房窗外花园',
        revealsInfo: '有人曾从窗户进出书房，且此人脚不小。',
        isKey: true,
      },
      {
        name: '女仆的证词',
        description: '女仆赵小蝶说案发前听到书房有争吵声，其中一人声音像小姐。',
        location: '仆人房',
        revealsInfo: '案发前陈老爷与人激烈争吵，嫌疑人可能是李婉清。',
        isKey: false,
      },
      {
        name: '撕碎的借条',
        description: '书房垃圾桶里被撕碎的借条，拼凑后显示孙伯年欠款巨大。',
        location: '书房垃圾桶',
        revealsInfo: '孙伯年欠陈老爷一大笔钱，有谋财害命的动机。',
        isKey: false,
      },
      {
        name: '药瓶上的指纹',
        description: '陈老爷床头的止痛药瓶上有周大夫的指纹。',
        location: '卧室床头柜',
        revealsInfo: '周大夫最近频繁调整陈老爷的用药，且只有他能接触药物。',
        isKey: false,
      },
    ],
  },

  // ========== 剧本 2：游轮迷案 ==========
  {
    title: '游轮迷案',
    victim: '威廉船长',
    crimeScene: '豪华游轮"玛丽皇后号"的船长室，威廉船长被发现死在办公桌前，桌上的航海日志被撕掉了几页……',
    murderWeapon: '银质拆信刀',
    location: '玛丽皇后号游轮',
    synopsis: '一艘从上海开往旧金山的豪华游轮上，船长威廉在自己的船长室遇害。凶器是他桌上的银质拆信刀，航海日志缺失了几页。当晚游轮遭遇风暴，通讯中断，凶手就在船上的乘客之中。',
    characters: [
      {
        name: '苏菲亚',
        role: '大副',
        personality: '干练、果断、野心勃勃',
        backstory: '游轮的大副，航海经验丰富，一直想晋升船长，但威廉总压她一头。',
        secret: '船长室的备用钥匙她有一把，而且她知道威廉即将退休。',
        objectives: [{ type: 'find_truth' as const, description: '证明自己的清白，争取晋升机会。', reward: '真相', isComplete: false }],
        alibi: '案发时在驾驶台值班，水手们可以作证。',
        relationshipToVictim: '上下级关系，因晋升问题有矛盾。',
      },
      {
        name: '艾德蒙',
        role: '富商乘客',
        personality: '傲慢、精明、出手阔绰',
        backstory: '一位做跨国贸易的富商，包下了游轮顶层的豪华套房。',
        secret: '他此次携带的货物中藏有违禁品，而威廉船长似乎发现了。',
        objectives: [{ type: 'find_truth' as const, description: '掩盖自己的违禁品生意，不要被牵连。', reward: '真相', isComplete: false }],
        alibi: '案发时在自己的套房里休息，服务生可以作证。',
        relationshipToVictim: '乘客与船长，因货物检查产生过冲突。',
      },
      {
        name: '薇薇安',
        role: '女明星',
        personality: '风情万种、敏感、爱出风头',
        backstory: '当红电影明星，此次乘船是为了去好莱坞拍戏。',
        secret: '她与威廉船长有一段不为人知的婚外情，最近想分手。',
        objectives: [{ type: 'find_truth' as const, description: '隐藏自己的私情，不要让丑闻曝光。', reward: '真相', isComplete: false }],
        alibi: '案发时在酒吧喝酒，酒保可以作证。',
        relationshipToVictim: '秘密情人关系，近期因分手问题纠缠不清。',
      },
      {
        name: '老周',
        role: '轮机长',
        personality: '沉默寡言、技术过硬、性格倔强',
        backstory: '在船上工作了二十年的老轮机长，负责游轮的动力系统。',
        secret: '他知道游轮的发动机有严重故障，但威廉为了省钱一直不让修。',
        objectives: [{ type: 'find_truth' as const, description: '保护自己和船员，不要让游轮事故的事被公开。', reward: '真相', isComplete: false }],
        alibi: '案发时在轮机舱检查设备，有声响记录。',
        relationshipToVictim: '同事关系，因安全问题多次争吵。',
      },
      {
        name: '陈先生',
        role: '神秘乘客',
        personality: '低调、神秘、行踪不定',
        backstory: '一位戴着墨镜、从不摘下帽子的中年男子，独自旅行。',
        secret: '他其实是一名私家侦探，受雇调查威廉船长的走私行为。',
        objectives: [{ type: 'find_truth' as const, description: '完成调查任务，揭露真相。', reward: '真相', isComplete: false }],
        alibi: '案发时在甲板上看海，没人注意到他。',
        relationshipToVictim: '调查者与被调查者，暗中跟踪。',
      },
      {
        name: '莉莉',
        role: '酒吧调酒师',
        personality: '活泼、健谈、消息灵通',
        backstory: '游轮酒吧的调酒师，认识船上所有的常客。',
        secret: '她看到薇薇安案发前不久从船长室方向跑出来，神情慌张。',
        objectives: [{ type: 'find_truth' as const, description: '说出自己看到的真相，但不想惹麻烦。', reward: '真相', isComplete: false }],
        alibi: '案发时在酒吧值班，有监控为证。',
        relationshipToVictim: '服务员与客人，偶尔闲聊。',
      },
      {
        name: '海警王队长',
        role: '海警队长',
        personality: '威严、干练、铁面无私',
        backstory: '负责这片海域的海警队长，因接到匿名举报随船巡逻，恰遇命案。',
        secret: '他私下收过艾德蒙的"好处费"，对其走私行为睁一只眼闭一只眼。',
        objectives: [{ type: 'find_truth' as const, description: '破案，同时不要让自己受贿的事曝光。', reward: '真相', isComplete: false }],
        alibi: '案发时在海警艇上，有船员作证。',
        relationshipToVictim: '负责调查此案的海警，与死者有过公务接触。',
      },
    ],
    clues: [
      {
        name: '银质拆信刀',
        description: '船长办公桌上的银质拆信刀，是凶器。',
        location: '船长室办公桌',
        revealsInfo: '凶手用拆信刀刺中威廉船长的心脏。',
        isKey: true,
      },
      {
        name: '缺失的航海日志',
        description: '航海日志被撕掉了几页，时间正好是最近一周。',
        location: '船长室书架',
        revealsInfo: '威廉船长在日志中记录了一些秘密，凶手销毁了相关内容。',
        isKey: true,
      },
      {
        name: '船长室备用钥匙',
        description: '大副苏菲亚手中有一把船长室的备用钥匙。',
        location: '大副房间',
        revealsInfo: '苏菲亚可以自由出入船长室，有作案条件。',
        isKey: true,
      },
      {
        name: '未报关的货物单',
        description: '富商艾德蒙的行李中发现了一批未报关的珍贵文物。',
        location: '艾德蒙的套房',
        revealsInfo: '艾德蒙有走私嫌疑，威廉船长可能因此被灭口。',
        isKey: false,
      },
      {
        name: '撕碎的情书',
        description: '船长室垃圾桶里有撕碎的情书，字迹是薇薇安的。',
        location: '船长室垃圾桶',
        revealsInfo: '薇薇安与威廉有私情，且近期关系恶化。',
        isKey: false,
      },
      {
        name: '轮机舱的维修记录',
        description: '轮机长老周多次提交发动机维修申请，均被威廉驳回。',
        location: '轮机舱',
        revealsInfo: '老周对威廉积怨已久，且有制造事故的动机。',
        isKey: false,
      },
    ],
  },

  // ========== 剧本 3：剧院幽灵 ==========
  {
    title: '剧院幽灵',
    victim: '林首席',
    crimeScene: '国家大剧院的后台化妆间，林首席倒在镜子前，脸上还残留着震惊的表情……',
    murderWeapon: '化妆镜碎片',
    location: '国家大剧院',
    synopsis: '国家大剧院首席女演员林首席在演出前被发现死在自己的化妆间。凶器是化妆镜的碎片，化妆台上有一杯喝了一半的咖啡。当晚剧院正在上演经典歌剧《茶花女》，后台人来人往，谁都有可能是凶手。',
    characters: [
      {
        name: '方导演',
        role: '歌剧导演',
        personality: '严厉、追求完美、脾气暴躁',
        backstory: '该剧的导演，与林首席合作多年，但近期因艺术理念分歧频繁争吵。',
        secret: '他知道林首席打算退出剧院，去百老汇发展，这会毁了他的新剧。',
        objectives: [{ type: 'find_truth' as const, description: '保住自己的新剧，不让林首席离开的消息影响票房。', reward: '真相', isComplete: false }],
        alibi: '案发时在排练厅指导其他演员，多人可证。',
        relationshipToVictim: '导演与主演，因艺术理念产生矛盾。',
      },
      {
        name: '苏副首席',
        role: '女二号',
        personality: '温柔、隐忍、表面谦逊',
        backstory: '剧院的女二号，一直活在林首席的光环下，等待了十年才有机会。',
        secret: '只要林首席出意外，她就能顶替成为首席，这是她梦寐以求的。',
        objectives: [{ type: 'find_truth' as const, description: '成为首席，同时不被怀疑。', reward: '真相', isComplete: false }],
        alibi: '案发时在自己的化妆间背台词，没人作证。',
        relationshipToVictim: '同事与竞争对手，长期被压制。',
      },
      {
        name: '钱老板',
        role: '剧院投资人',
        personality: '精明、圆滑、只看利益',
        backstory: '剧院的主要投资人，出资支持了这部歌剧的制作。',
        secret: '他与林首席签了一份天价演出合同，如果林首席无法演出，他将损失惨重。',
        objectives: [{ type: 'find_truth' as const, description: '确保投资回报，不想让丑闻影响剧院声誉。', reward: '真相', isComplete: false }],
        alibi: '案发时在贵宾室接待赞助商，有接待记录。',
        relationshipToVictim: '投资人与演员，有合同关系。',
      },
      {
        name: '化妆师阿静',
        role: '首席化妆师',
        personality: '细腻、内向、观察力强',
        backstory: '林首席的专属化妆师，跟了她五年，知道她所有的秘密。',
        secret: '她发现林首席的咖啡里被人动了手脚，但不确定是谁。',
        objectives: [{ type: 'find_truth' as const, description: '说出真相，但要保护自己不被报复。', reward: '真相', isComplete: false }],
        alibi: '案发时在化妆间整理化妆品，有同事看到。',
        relationshipToVictim: '化妆师与艺人，关系亲密但有秘密。',
      },
      {
        name: '张指挥',
        role: '乐团指挥',
        personality: '优雅、博学、风流倜傥',
        backstory: '乐团的首席指挥，与林首席有过一段恋情，最近分手。',
        secret: '他发现林首席在偷偷服用安眠药，且剂量越来越大。',
        objectives: [{ type: 'find_truth' as const, description: '保护林首席的名誉，不让她的私生活曝光。', reward: '真相', isComplete: false }],
        alibi: '案发时在乐池调试乐器，乐手们可证。',
        relationshipToVictim: '前任恋人，因感情问题分手。',
      },
      {
        name: '保安老陈',
        role: '剧院保安',
        personality: '老实、木讷、尽职尽责',
        backstory: '剧院的老保安，负责后台的安全巡查。',
        secret: '他看到苏副首席案发前曾从林首席的化妆间出来，神情紧张。',
        objectives: [{ type: 'find_truth' as const, description: '说出真相，但怕被人报复。', reward: '真相', isComplete: false }],
        alibi: '案发时在后台巡逻，有签到记录。',
        relationshipToVictim: '保安与艺人，平时只是点头之交。',
      },
      {
        name: '刘警官',
        role: '驻场警察',
        personality: '沉稳、细致、观察力强',
        backstory: '负责剧院片区治安的警官，当晚正在剧院巡查，案发后封锁了现场。',
        secret: '他欠了钱老板一笔赌债，钱老板曾暗示他"照顾"一下剧院的事。',
        objectives: [{ type: 'find_truth' as const, description: '破案，但不想让自己和钱老板的债务关系被人知道。', reward: '真相', isComplete: false }],
        alibi: '案发时在剧院大堂巡查，有监控为证。',
        relationshipToVictim: '负责调查此案的警官，与死者有过几面之缘。',
      },
    ],
    clues: [
      {
        name: '化妆镜碎片',
        description: '破碎的化妆镜碎片上有血迹，是凶器。',
        location: '林首席化妆间',
        revealsInfo: '凶手用化妆镜碎片划伤了林首席的颈动脉。',
        isKey: true,
      },
      {
        name: '半杯咖啡',
        description: '化妆台上喝了一半的咖啡，检测出有安眠药成分。',
        location: '林首席化妆间',
        revealsInfo: '林首席生前被人下药，失去了反抗能力。',
        isKey: true,
      },
      {
        name: '辞职信',
        description: '林首席包里有一封未寄出的辞职信，要离开剧院去百老汇。',
        location: '林首席化妆间',
        revealsInfo: '林首席即将离开，方导演和钱老板都有阻止她的动机。',
        isKey: true,
      },
      {
        name: '苏副首席的手套',
        description: '苏副首席的化妆间里有一双沾血的手套。',
        location: '苏副首席化妆间',
        revealsInfo: '苏副首席可能是凶手，手套上的血迹还未处理。',
        isKey: true,
      },
      {
        name: '安眠药瓶',
        description: '张指挥的抽屉里有一瓶安眠药，与咖啡中的成分一致。',
        location: '指挥休息室',
        revealsInfo: '张指挥有安眠药，可能是下药的人。',
        isKey: false,
      },
      {
        name: '演出合同',
        description: '钱老板与林首席签订的天价合同，违约金高达千万。',
        location: '钱老板办公室',
        revealsInfo: '如果林首席退出，钱老板将损失惨重。',
        isKey: false,
      },
    ],
  },

  // ========== 剧本 4：雪山旅馆 ==========
  {
    title: '雪山旅馆',
    victim: '马老板',
    crimeScene: '雪山深处的"白鹿旅馆"，马老板被发现死在自己的房间里，窗外是暴风雪，电话线被剪断了……',
    murderWeapon: '冰锥',
    location: '白鹿雪山旅馆',
    synopsis: '一场暴风雪切断了白鹿旅馆与外界的联系。旅馆老板马老板被发现死在自己的房间，凶器是旅馆的冰锥。被困在旅馆的六个旅客中，谁是凶手？随着暴风雪持续，真相逐渐浮出水面。',
    characters: [
      {
        name: '林雪',
        role: '旅馆老板娘',
        personality: '热情、精明、但藏着心事',
        backstory: '马老板的妻子，经营这家旅馆多年，最近发现丈夫有外遇。',
        secret: '她知道丈夫在外面有女人，且正在转移财产。',
        objectives: [{ type: 'find_truth' as const, description: '保护旅馆，同时为自己讨回公道。', reward: '真相', isComplete: false }],
        alibi: '案发时在厨房准备晚餐，有客人看到。',
        relationshipToVictim: '夫妻关系，因外遇和财产问题关系紧张。',
      },
      {
        name: '何律师',
        role: '离婚律师',
        personality: '冷静、专业、观察力强',
        backstory: '一位专门打离婚官司的律师，此次是来滑雪度假的。',
        secret: '他其实是林雪请来的，准备帮她打离婚官司。',
        objectives: [{ type: 'find_truth' as const, description: '完成自己的委托，不要被卷入命案。', reward: '真相', isComplete: false }],
        alibi: '案发时在大堂看书，前台可证。',
        relationshipToVictim: '律师与客户的丈夫，潜在对立。',
      },
      {
        name: '小美',
        role: '年轻女游客',
        personality: '活泼、外向、有些任性',
        backstory: '一位独自来滑雪的年轻女孩，自称是来散心的。',
        secret: '她其实是马老板的情妇，此次是来与马老板私会的。',
        objectives: [{ type: 'find_truth' as const, description: '隐藏自己与马老板的关系，不要被林雪发现。', reward: '真相', isComplete: false }],
        alibi: '案发时在房间洗澡，没人作证。',
        relationshipToVictim: '情妇关系，秘密交往。',
      },
      {
        name: '老赵',
        role: '退休刑警',
        personality: '沉稳、老练、洞察力惊人',
        backstory: '一位退休的老刑警，来雪山静养，身体不好但脑子清醒。',
        secret: '他注意到马老板最近似乎在被人威胁，收到过恐吓信。',
        objectives: [{ type: 'find_truth' as const, description: '利用自己的经验找出真凶。', reward: '真相', isComplete: false }],
        alibi: '案发时在大堂壁炉旁烤火，有多人看到。',
        relationshipToVictim: '陌生人，只是住客。',
      },
      {
        name: '阿强',
        role: '旅馆维修工',
        personality: '沉默、勤劳、但眼神阴郁',
        backstory: '旅馆的维修工，在这里工作了三年，沉默寡言。',
        secret: '他的妹妹曾在这家旅馆工作，后被马老板侵犯后自杀。',
        objectives: [{ type: 'find_truth' as const, description: '为妹妹报仇，但要做得天衣无缝。', reward: '真相', isComplete: false }],
        alibi: '案发时在锅炉房修暖气，有维修记录。',
        relationshipToVictim: '员工与老板，有深仇大恨。',
      },
      {
        name: '王医生',
        role: '内科医生',
        personality: '温和、细心、乐于助人',
        backstory: '一位内科医生，和家人来度假，但家人因航班延误未到。',
        secret: '他发现马老板有心脏病，且案发前曾给马老板开过药。',
        objectives: [{ type: 'find_truth' as const, description: '救人，不要让自己的药物被用于犯罪。', reward: '真相', isComplete: false }],
        alibi: '案发时在房间整理医疗包，有电话记录。',
        relationshipToVictim: '医生与病人，曾为马老板诊疗。',
      },
      {
        name: '警员小李',
        role: '派出所警员',
        personality: '年轻、热情、但经验不足',
        backstory: '镇上派出所的年轻警员，因暴风雪被困在旅馆，协助调查此案。',
        secret: '他偷偷喜欢小美，想在她面前表现自己。',
        objectives: [{ type: 'find_truth' as const, description: '破案，在小美面前证明自己的能力。', reward: '真相', isComplete: false }],
        alibi: '案发时在大堂帮忙铲雪，有多人看到。',
        relationshipToVictim: '负责协助调查的警员，与死者素不相识。',
      },
    ],
    clues: [
      {
        name: '冰锥',
        description: '旅馆厨房的冰锥，是凶器，上面有血迹。',
        location: '马老板房间',
        revealsInfo: '凶手用冰锥刺中马老板的胸口。',
        isKey: true,
      },
      {
        name: '被剪断的电话线',
        description: '旅馆的电话线被人剪断了，无法报警。',
        location: '旅馆外墙',
        revealsInfo: '凶手有预谋，切断了通讯，阻止报警。',
        isKey: true,
      },
      {
        name: '恐吓信',
        description: '马老板房间里有一封恐吓信，字迹是打印的。',
        location: '马老板房间抽屉',
        revealsInfo: '马老板近期被人威胁，凶手可能是预谋作案。',
        isKey: false,
      },
      {
        name: '林雪的离婚协议',
        description: '林雪房间里有一份已签字的离婚协议。',
        location: '老板娘房间',
        revealsInfo: '林雪已决定离婚，且知道马老板转移财产。',
        isKey: false,
      },
      {
        name: '小美与马老板的合影',
        description: '小美钱包里有她与马老板的亲密合影。',
        location: '小美房间',
        revealsInfo: '小美是马老板的情妇，有情感纠葛。',
        isKey: false,
      },
      {
        name: '阿强妹妹的日记',
        description: '阿强房间里有一本日记，记录了妹妹被马老板侵犯的经过。',
        location: '阿强房间',
        revealsInfo: '阿强有强烈的复仇动机，是最大嫌疑人之一。',
        isKey: true,
      },
    ],
  },

  // ========== 剧本 5：列车谋杀 ==========
  {
    title: '东方列车谋杀',
    victim: '金先生',
    crimeScene: '东方快车的豪华包厢里，金先生被发现死在床上，包厢的门从内部锁着，车窗开着一条缝……',
    murderWeapon: '毒针',
    location: '东方快车',
    synopsis: '东方快车上，富商金先生在自己的豪华包厢内遇害。凶器是一根浸过毒的细针，包厢门从内部反锁。列车上的六个乘客都与金先生有着千丝万缕的联系，谁是真正的凶手？',
    characters: [
      {
        name: '卡佳',
        role: '俄国女伯爵',
        personality: '高贵、优雅、心思缜密',
        backstory: '一位落魄的俄国贵族后裔，靠变卖珠宝维生。',
        secret: '她的家族曾被金先生用不正当手段搞垮，她一直在寻找复仇机会。',
        objectives: [{ type: 'find_truth' as const, description: '为家族复仇，同时保住自己的贵族身份。', reward: '真相', isComplete: false }],
        alibi: '案发时在自己的包厢里休息，列车员可证。',
        relationshipToVictim: '仇人，家族世仇。',
      },
      {
        name: '麦克',
        role: '美国商人',
        personality: '豪爽、健谈、但眼神闪烁',
        backstory: '一位做进出口贸易的美国商人，与金先生有多年生意往来。',
        secret: '他最近被金先生骗了一大笔钱，正在找金先生讨债。',
        objectives: [{ type: 'find_truth' as const, description: '讨回自己的钱，不要让金先生的死影响生意。', reward: '真相', isComplete: false }],
        alibi: '案发时在餐车喝酒，有服务员作证。',
        relationshipToVictim: '生意伙伴，因诈骗产生矛盾。',
      },
      {
        name: '林小姐',
        role: '神秘东方女子',
        personality: '神秘、冷淡、独来独往',
        backstory: '一位独自旅行的东方女子，话不多，但气质不凡。',
        secret: '她其实是金先生的私生女，此次是来认亲的，但金先生不认她。',
        objectives: [{ type: 'find_truth' as const, description: '让金先生认她这个女儿，否则她什么都得不到。', reward: '真相', isComplete: false }],
        alibi: '案发时在走廊散步，没人注意到她。',
        relationshipToVictim: '私生女，被拒绝认亲。',
      },
      {
        name: '皮埃尔',
        role: '法国医生',
        personality: '儒雅、博学、乐于助人',
        backstory: '一位法国医生，此次去东方参加医学会议。',
        secret: '他认出金先生是多年前一桩医疗事故的责任人，但金先生花钱摆平了。',
        objectives: [{ type: 'find_truth' as const, description: '让金先生为当年的事付出代价，但要做得不留痕迹。', reward: '真相', isComplete: false }],
        alibi: '案发时在自己的包厢研究医学论文。',
        relationshipToVictim: '医生与事故责任人，有旧怨。',
      },
      {
        name: '列车长老张',
        role: '列车长',
        personality: '老练、圆滑、善于周旋',
        backstory: '东方快车的老列车长，熟悉每一位常客。',
        secret: '他知道金先生在列车上做非法交易，且收过金先生的贿赂。',
        objectives: [{ type: 'find_truth' as const, description: '掩盖自己受贿的事，同时配合调查。', reward: '真相', isComplete: false }],
        alibi: '案发时在值班室，有值班记录。',
        relationshipToVictim: '服务人员与常客，有利益往来。',
      },
      {
        name: '安娜',
        role: '德国教师',
        personality: '严谨、正直、一丝不苟',
        backstory: '一位德国历史教师，此次是去东方旅行考察。',
        secret: '她是金先生前妻的妹妹，金先生曾对姐姐家暴，导致姐姐早逝。',
        objectives: [{ type: 'find_truth' as const, description: '为姐姐讨回公道，让金先生付出代价。', reward: '真相', isComplete: false }],
        alibi: '案发时在看书，有同行旅客作证。',
        relationshipToVictim: '前妻的妹妹，有家庭仇恨。',
      },
      {
        name: '国际刑警马先生',
        role: '国际刑警',
        personality: '冷静、睿智、深藏不露',
        backstory: '国际刑警组织的探员，此次搭车是为了追踪一名跨国逃犯，恰遇命案。',
        secret: '他追踪的逃犯就藏在这趟列车上，他不能暴露自己的身份。',
        objectives: [{ type: 'find_truth' as const, description: '找出命案凶手，同时不要让逃犯察觉自己的存在。', reward: '真相', isComplete: false }],
        alibi: '案发时在自己的包厢整理案件资料，无人作证。',
        relationshipToVictim: '负责调查此案的刑警，与死者素不相识。',
      },
    ],
    clues: [
      {
        name: '毒针',
        description: '一根浸过毒液的细针，藏在金先生的枕头下，是凶器。',
        location: '金先生的包厢',
        revealsInfo: '凶手用毒针刺中金先生的脖子，导致其中毒身亡。',
        isKey: true,
      },
      {
        name: '反锁的包厢门',
        description: '包厢的门从内部反锁，只有车窗开了一条缝。',
        location: '金先生的包厢',
        revealsInfo: '凶手可能是从车窗进入或离开，或者有包厢钥匙。',
        isKey: true,
      },
      {
        name: '家族勋章',
        description: '卡佳的包厢里有一枚与金先生有关的家族勋章。',
        location: '卡佳的包厢',
        revealsInfo: '卡佳的家族与金先生有世仇，有复仇动机。',
        isKey: false,
      },
      {
        name: '欠条',
        description: '麦克的包里有一张金先生签字的巨额欠条。',
        location: '麦克的包厢',
        revealsInfo: '麦克被金先生骗了钱，有经济纠纷。',
        isKey: false,
      },
      {
        name: '医学书籍',
        description: '皮埃尔的包厢里有关于毒物学的医学书籍。',
        location: '皮埃尔的包厢',
        revealsInfo: '皮埃尔懂得毒物知识，有作案能力。',
        isKey: true,
      },
      {
        name: '旧照片',
        description: '安娜的钱包里有一张姐姐与金先生的合影，背面写着"血债血偿"。',
        location: '安娜的包厢',
        revealsInfo: '安娜的姐姐因金先生而死，她有强烈的复仇动机。',
        isKey: false,
      },
    ],
  },

  // ========== 剧本 6：实验室疑案 ==========
  {
    title: '实验室疑案',
    victim: '李博士',
    crimeScene: '生物科技公司的绝密实验室里，李博士倒在实验台前，手边散落着实验数据的打印纸，实验室的安全门从内部锁着……',
    murderWeapon: '注射针头',
    location: '创世生物科技实验室',
    synopsis: '创世生物科技公司的首席科学家李博士在绝密实验室内遇害。凶器是一根注射针头，实验室的安全门从内部反锁。李博士的研究即将取得重大突破，六位相关人员中，谁是凶手？',
    characters: [
      {
        name: '王总',
        role: '公司CEO',
        personality: '精明、强势、利益至上',
        backstory: '创世生物的创始人兼CEO，对李博士的研究投入了巨资。',
        secret: '他打算把李博士的研究成果卖给军方，而李博士坚决反对。',
        objectives: [{ type: 'find_truth' as const, description: '拿到研究成果，不要让李博士的反对影响公司上市。', reward: '真相', isComplete: false }],
        alibi: '案发时在办公室开会，有会议记录。',
        relationshipToVictim: '老板与首席科学家，因研究去向产生分歧。',
      },
      {
        name: '陈研究员',
        role: '副手研究员',
        personality: '聪明、勤奋、但有些急躁',
        backstory: '李博士的得力助手，参与了项目的核心研究。',
        secret: '他对研究成果的署名权不满，觉得自己的贡献被忽视了。',
        objectives: [{ type: 'find_truth' as const, description: '获得应有的署名权和荣誉。', reward: '真相', isComplete: false }],
        alibi: '案发时在数据室整理资料，有监控。',
        relationshipToVictim: '师徒与同事，因署名问题有矛盾。',
      },
      {
        name: '苏秘书',
        role: '李博士秘书',
        personality: '细致、安静、尽职尽责',
        backstory: '李博士的私人秘书，负责他的日程和文件管理。',
        secret: '她发现王总在偷偷拷贝李博士的实验数据，但不敢声张。',
        objectives: [{ type: 'find_truth' as const, description: '保护李博士的研究成果，同时保全自己的工作。', reward: '真相', isComplete: false }],
        alibi: '案发时在前台处理文件，有同事作证。',
        relationshipToVictim: '秘书与老板，关系亲近但有隐情。',
      },
      {
        name: '赵保安',
        role: '实验室保安',
        personality: '老实、本分、但有些木讷',
        backstory: '实验室的保安，负责安保工作，有权限进入所有区域。',
        secret: '他发现实验室的门禁系统在案发时间段被人绕过了。',
        objectives: [{ type: 'find_truth' as const, description: '说出真相，但怕被人利用。', reward: '真相', isComplete: false }],
        alibi: '案发时在值班室，有监控。',
        relationshipToVictim: '保安与员工，平时接触不多。',
      },
      {
        name: '钱教授',
        role: '学术对手',
        personality: '傲慢、好胜、嫉妒心强',
        backstory: '另一所大学的教授，与李博士研究同一领域，是竞争对手。',
        secret: '他曾试图窃取李博士的研究数据，但被发现了。',
        objectives: [{ type: 'find_truth' as const, description: '在学术竞争中胜出，不让李博士先发表成果。', reward: '真相', isComplete: false }],
        alibi: '案发时在自己的实验室，有助手作证。',
        relationshipToVictim: '学术竞争对手，长期敌对。',
      },
      {
        name: '孙记者',
        role: '科技记者',
        personality: '敏锐、好奇、不达目的不罢休',
        backstory: '一位跑科技线的记者，一直在追踪李博士的研究项目。',
        secret: '她收到了匿名举报，说李博士的研究存在伦理问题。',
        objectives: [{ type: 'find_truth' as const, description: '挖出独家新闻，揭露真相。', reward: '真相', isComplete: false }],
        alibi: '案发时在公司大堂等待采访，有前台记录。',
        relationshipToVictim: '记者与采访对象，试图挖掘内幕。',
      },
      {
        name: '网警林警官',
        role: '网安支队警官',
        personality: '理性、专业、不苟言笑',
        backstory: '公安局网安支队的警官，负责调查实验室的数据泄露案，案发时正在现场。',
        secret: '他与王总是大学同学，曾收过王总的"咨询费"。',
        objectives: [{ type: 'find_truth' as const, description: '破案，但不要让自己和王总的关系影响调查公正性。', reward: '真相', isComplete: false }],
        alibi: '案发时在安保室查看监控，有记录为证。',
        relationshipToVictim: '负责调查此案的警官，与死者有工作接触。',
      },
    ],
    clues: [
      {
        name: '注射针头',
        description: '实验台上的注射针头，上面有李博士的血迹和未知药物。',
        location: '实验室',
        revealsInfo: '凶手用注射针头向李博士体内注射了致命药物。',
        isKey: true,
      },
      {
        name: '反锁的安全门',
        description: '实验室的安全门从内部反锁，只有李博士有钥匙。',
        location: '实验室入口',
        revealsInfo: '凶手要么有钥匙，要么是李博士主动让其进入的。',
        isKey: true,
      },
      {
        name: '军用合同草案',
        description: '王总办公室有一份与军方的合作合同草案，涉及李博士的研究。',
        location: '王总办公室',
        revealsInfo: '王总想把研究卖给军方，与李博士有严重分歧。',
        isKey: true,
      },
      {
        name: '署名申请邮件',
        description: '陈研究员的邮箱里有一封给李博士的邮件，要求增加署名。',
        location: '数据室电脑',
        revealsInfo: '陈研究员对署名权不满，有动机。',
        isKey: false,
      },
      {
        name: '门禁记录异常',
        description: '案发时段，实验室门禁系统被人用管理员权限绕过。',
        location: '安保室',
        revealsInfo: '有权限绕过门禁的人不多，赵保安和王总都有。',
        isKey: false,
      },
      {
        name: '匿名举报信',
        description: '孙记者收到的匿名举报信，指控李博士的研究违反伦理。',
        location: '孙记者的包里',
        revealsInfo: '有人想搞臭李博士的名声，可能是竞争对手。',
        isKey: false,
      },
    ],
  },

  // ========== 剧本 7：寺庙命案 ==========
  {
    title: '寺庙命案',
    victim: '慧明方丈',
    crimeScene: '深山古寺"静心寺"的禅房里，慧明方丈盘腿而坐，已无气息，手边放着一杯未喝完的茶……',
    murderWeapon: '毒药',
    location: '静心寺',
    synopsis: '深山古寺静心寺的慧明方丈在禅房内圆寂（实为被害）。法医鉴定为中毒，凶器是茶中的毒药。当晚留宿寺中的六个人中，谁是凶手？这座千年古寺究竟隐藏着什么秘密？',
    characters: [
      {
        name: '慧能',
        role: '首座僧人',
        personality: '沉稳、虔诚、但心事重重',
        backstory: '静心寺的首座僧人，跟随慧明方丈三十年，是最有可能的继承人。',
        secret: '他知道慧明方丈要把住持之位传给新来的慧空，而不是他。',
        objectives: [{ type: 'find_truth' as const, description: '成为住持，维护寺庙的传统。', reward: '真相', isComplete: false }],
        alibi: '案发时在大殿念经，有其他僧人作证。',
        relationshipToVictim: '师徒与继承人，因传承问题产生矛盾。',
      },
      {
        name: '慧空',
        role: '新来的僧人',
        personality: '聪慧、机敏、但有些功利',
        backstory: '半年前才来静心寺的年轻僧人，深得慧明方丈器重。',
        secret: '他其实是富商之子，来寺庙是为了躲避仇家，不是真想出家。',
        objectives: [{ type: 'find_truth' as const, description: '在寺庙里安稳度日，不要暴露身份。', reward: '真相', isComplete: false }],
        alibi: '案发时在自己的禅房打坐，没人作证。',
        relationshipToVictim: '师徒，被破格器重引发他人不满。',
      },
      {
        name: '王施主',
        role: '大施主',
        personality: '豪爽、富有、但内心焦虑',
        backstory: '静心寺最大的施主，捐钱修缮了寺庙多处建筑。',
        secret: '他的公司即将破产，想让慧明方丈帮他做一场法事转运，被拒绝了。',
        objectives: [{ type: 'find_truth' as const, description: '让自己的生意好转，不要破产。', reward: '真相', isComplete: false }],
        alibi: '案发时在客房休息，有小沙弥送过水。',
        relationshipToVictim: '施主与方丈，因法事请求被拒产生不快。',
      },
      {
        name: '陈医生',
        role: '游方郎中',
        personality: '温和、博学、但行踪神秘',
        backstory: '一位游方郎中，来寺庙是为了采药和拜访老友慧明方丈。',
        secret: '他知道慧明方丈身患重病，且最近给他开的药方被人动过手脚。',
        objectives: [{ type: 'find_truth' as const, description: '查明药方被谁动了手脚，为老友讨回公道。', reward: '真相', isComplete: false }],
        alibi: '案发时在后山采药，有药篓为证。',
        relationshipToVictim: '老友，亦是医生与病人。',
      },
      {
        name: '小沙弥',
        role: '寺庙杂役',
        personality: '胆小、机灵、善于观察',
        backstory: '寺庙里的小沙弥，负责打扫和端茶倒水，知道很多秘密。',
        secret: '他看到慧能师兄在案发前曾去过方丈的禅房，且神情紧张。',
        objectives: [{ type: 'find_truth' as const, description: '说出真相，但怕被师兄们报复。', reward: '真相', isComplete: false }],
        alibi: '案发时在厨房烧水，有厨师作证。',
        relationshipToVictim: '晚辈与长辈，平时受方丈照顾。',
      },
      {
        name: '李寡妇',
        role: '烧香的寡妇',
        personality: '虔诚、哀怨、但眼神坚定',
        backstory: '一位刚丧夫的寡妇，来寺庙为亡夫做超度法事。',
        secret: '她的丈夫生前与慧明方丈有过激烈争执，她怀疑方丈害了她丈夫。',
        objectives: [{ type: 'find_truth' as const, description: '为亡夫报仇，同时获得心灵的平静。', reward: '真相', isComplete: false }],
        alibi: '案发时在客房念经，有其他香客作证。',
        relationshipToVictim: '香客与方丈，有杀夫之仇。',
      },
      {
        name: '赵捕头',
        role: '县衙捕头',
        personality: '豪爽、正直、但有些鲁莽',
        backstory: '当地县衙的捕头，接到报案后冒雪上山，负责侦办此案。',
        secret: '他曾因办错案被降职，急于破案官复原职。',
        objectives: [{ type: 'find_truth' as const, description: '破案立功，官复原职。', reward: '真相', isComplete: false }],
        alibi: '案发后才赶到寺庙，有衙役陪同。',
        relationshipToVictim: '负责调查此案的捕头，与死者素不相识。',
      },
    ],
    clues: [
      {
        name: '有毒的茶',
        description: '慧明方丈手边的茶中检测出有毒成分，是凶器。',
        location: '方丈禅房',
        revealsInfo: '凶手在茶中下毒，导致慧明方丈中毒身亡。',
        isKey: true,
      },
      {
        name: '传承遗嘱',
        description: '慧明方丈禅房里有一份遗嘱，将住持之位传给慧空。',
        location: '方丈禅房',
        revealsInfo: '慧能因此失去继承资格，有强烈的动机。',
        isKey: true,
      },
      {
        name: '小沙弥的证词',
        description: '小沙弥说案发前看到慧能去过方丈禅房，神情紧张。',
        location: '厨房',
        revealsInfo: '慧能在案发前与方丈有过接触，是重要嫌疑人。',
        isKey: true,
      },
      {
        name: '被篡改的药方',
        description: '陈医生给慧明方丈开的药方被人篡改过，增加了有毒成分。',
        location: '药房',
        revealsInfo: '有人能接触药房，且懂得药理，陈医生和慧能都有嫌疑。',
        isKey: false,
      },
      {
        name: '慧空的身份证明',
        description: '慧空的禅房里有一张富商之子的身份证明。',
        location: '慧空禅房',
        revealsInfo: '慧空不是真心出家，而是来躲避仇家的。',
        isKey: false,
      },
      {
        name: '李寡妇丈夫的遗书',
        description: '李寡妇的包里有一封丈夫的遗书，提到慧明方丈。',
        location: '李寡妇客房',
        revealsInfo: '李寡妇的丈夫死前与慧明方丈有过节，她有复仇动机。',
        isKey: false,
      },
    ],
  },

  // ========== 剧本 8：庄园晚宴 ==========
  {
    title: '庄园晚宴',
    victim: '詹姆斯爵士',
    crimeScene: '玫瑰庄园的宴会厅，詹姆斯爵士在众目睽睽之下举杯后倒地……',
    murderWeapon: '毒酒',
    location: '玫瑰庄园',
    synopsis: '英国玫瑰庄园的主人詹姆斯爵士在自己举办的晚宴上举杯后倒地身亡。酒杯中检测出剧毒。当晚的六位宾客都与爵士有着复杂的关系，谁是凶手？一场盛大的晚宴变成了致命的棋局。',
    characters: [
      {
        name: '艾米丽夫人',
        role: '爵士妻子',
        personality: '优雅、端庄、但藏着怨恨',
        backstory: '詹姆斯爵士的妻子，结婚三十年，爵士近年来有了外遇。',
        secret: '她发现爵士要与她离婚，把财产留给情妇。',
        objectives: [{ type: 'find_truth' as const, description: '保住自己的地位和财产，不让情妇得逞。', reward: '真相', isComplete: false }],
        alibi: '案发时在自己的座位上，有多位宾客作证。',
        relationshipToVictim: '夫妻关系，因外遇和离婚问题矛盾激化。',
      },
      {
        name: '亨利爵士',
        role: '商业伙伴',
        personality: '精明、圆滑、笑里藏刀',
        backstory: '詹姆斯爵士的商业伙伴，两人合作多年，但近期在生意上产生分歧。',
        secret: '他发现詹姆斯爵士在偷偷转移公司资产，准备独自开公司。',
        objectives: [{ type: 'find_truth' as const, description: '阻止詹姆斯爵士的计划，保住自己的利益。', reward: '真相', isComplete: false }],
        alibi: '案发时在与其他宾客聊天，有多人作证。',
        relationshipToVictim: '商业伙伴，因资产问题产生矛盾。',
      },
      {
        name: '维多利亚小姐',
        role: '爵士情妇',
        personality: '美丽、娇媚、但心机深沉',
        backstory: '詹姆斯爵士的情妇，年轻貌美，深得爵士宠爱。',
        secret: '她其实是亨利爵士派来的间谍，目的是获取爵士的商业机密。',
        objectives: [{ type: 'find_truth' as const, description: '完成任务，同时不要暴露自己的真实身份。', reward: '真相', isComplete: false }],
        alibi: '案发时在阳台上透气，没人作证。',
        relationshipToVictim: '情妇与情夫，关系亲密但有隐情。',
      },
      {
        name: '老管家布朗',
        role: '庄园管家',
        personality: '忠诚、严谨、滴水不漏',
        backstory: '在玫瑰庄园服务了四十年的老管家，对庄园了如指掌。',
        secret: '他知道艾米丽夫人最近在研究毒药，且曾让他帮忙采购特殊药材。',
        objectives: [{ type: 'find_truth' as const, description: '保护庄园的秘密，同时不要牵连自己。', reward: '真相', isComplete: false }],
        alibi: '案发时在厨房监督上菜，有厨师作证。',
        relationshipToVictim: '主仆关系，忠诚但知道太多秘密。',
      },
      {
        name: '威廉医生',
        role: '家庭医生',
        personality: '儒雅、细心、值得信赖',
        backstory: '詹姆斯爵士的家庭医生，负责全家的健康。',
        secret: '他知道詹姆斯爵士的心脏不好，且爵士最近在服用一种与酒精冲突的药物。',
        objectives: [{ type: 'find_truth' as const, description: '保护病人，但不想泄露病人隐私。', reward: '真相', isComplete: false }],
        alibi: '案发时在休息室，有仆人作证。',
        relationshipToVictim: '医生与病人，亦是多年好友。',
      },
      {
        name: '汤姆',
        role: '爵士私生子',
        personality: '阴郁、沉默、带着恨意',
        backstory: '詹姆斯爵士的私生子，最近才被认回来，但爵士只给了他一个空头衔。',
        secret: '他发现爵士根本不打算把任何财产留给他，只是利用他做幌子。',
        objectives: [{ type: 'find_truth' as const, description: '获得应得的遗产，为自己和母亲讨回公道。', reward: '真相', isComplete: false }],
        alibi: '案发时在花园抽烟，没人作证。',
        relationshipToVictim: '私生子与生父，因遗产问题产生怨恨。',
      },
      {
        name: '雷斯垂德探长',
        role: '苏格兰场探长',
        personality: '严谨、固执、但能力平平',
        backstory: '苏格兰场派来调查此案的探长，自诩破案无数，实则常常依赖他人线索。',
        secret: '他收过亨利爵士的好处，曾帮其摆平过一桩商业纠纷。',
        objectives: [{ type: 'find_truth' as const, description: '破案，保住自己在苏格兰场的名声。', reward: '真相', isComplete: false }],
        alibi: '案发时在庄园门口与管家交谈，有仆人作证。',
        relationshipToVictim: '负责调查此案的探长，与死者有公务往来。',
      },
    ],
    clues: [
      {
        name: '毒酒杯',
        description: '詹姆斯爵士的酒杯中检测出剧毒物质，是凶器。',
        location: '宴会厅',
        revealsInfo: '有人在爵士的酒中下了毒，导致其中毒身亡。',
        isKey: true,
      },
      {
        name: '离婚协议书',
        description: '艾米丽夫人房间里有一份未签字的离婚协议书。',
        location: '艾米丽夫人房间',
        revealsInfo: '爵士要离婚，艾米丽夫人将失去一切，有强烈动机。',
        isKey: true,
      },
      {
        name: '毒药笔记',
        description: '艾米丽夫人的书桌上有一本关于毒药的笔记，记录了多种毒物的配制方法。',
        location: '艾米丽夫人房间',
        revealsInfo: '艾米丽夫人研究过毒药，有作案能力。',
        isKey: true,
      },
      {
        name: '商业机密文件',
        description: '维多利亚小姐的手包里有一份爵士公司的机密文件。',
        location: '维多利亚小姐房间',
        revealsInfo: '维多利亚小姐在窃取商业机密，身份可疑。',
        isKey: false,
      },
      {
        name: '特殊药材采购单',
        description: '老管家布朗的抽屉里有一张采购单，购买了多种罕见药材。',
        location: '管家房',
        revealsInfo: '布朗帮艾米丽夫人采购了制毒原料，有共犯嫌疑。',
        isKey: false,
      },
      {
        name: '被排除的遗嘱',
        description: '汤姆的房间里有一份遗嘱副本，上面没有他的名字。',
        location: '汤姆房间',
        revealsInfo: '汤姆被排除在遗产之外，有复仇动机。',
        isKey: false,
      },
    ],
  },
];

// 角色卡池（保留作为兜底，当某剧本角色数不足时使用）
export const CHARACTER_POOL: Omit<CharacterCard, 'id' | 'isMurderer'>[] =
  MYSTERY_SCENARIOS.flatMap((s) => s.characters);

// 线索池（保留作为兜底）
export const CLUE_POOL: Omit<ClueCard, 'id' | 'discoveredBy'>[] =
  MYSTERY_SCENARIOS.flatMap((s) => s.clues);
