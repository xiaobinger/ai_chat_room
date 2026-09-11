/** 谁是卧底游戏类型定义 */

export type UndercoverPhase = 'describing' | 'voting' | 'result';

export type UndercoverRole = 'civilian' | 'undercover';

export type UndercoverPersona = '谨慎试探型' | '联想发散型' | '稳健跟随型' | '大胆误导型';

export interface UndercoverPlayerState {
  playerId: string;
  nickname: string;
  role: UndercoverRole;
  persona: UndercoverPersona;
  /** 自己拿到的词 */
  word: string;
  isAlive: boolean;
  /** 本轮是否已描述 */
  hasDescribed: boolean;
  /** 累计被投票（AI 启发式） */
  suspicion: number;
  /** 出局轮次 */
  eliminatedRound?: number;
}

export interface UndercoverDescription {
  playerId: string;
  nickname: string;
  round: number;
  content: string;
}

export interface UndercoverGameEvent {
  id: string;
  round: number;
  phase: UndercoverPhase;
  type: 'phase_change' | 'player_action' | 'vote_result' | 'game_start' | 'game_end' | 'player_eliminated';
  actorName?: string;
  targetName?: string;
  content: string;
  timestamp: number;
}

export interface UndercoverPublicNote {
  round: number;
  content: string;
}

export interface UndercoverGameState {
  format: 2;
  phase: UndercoverPhase;
  round: number;
  players: UndercoverPlayerState[];
  /** 平民词 */
  civilianWord: string;
  /** 卧底词 */
  undercoverWord: string;
  /** 本轮描述记录 */
  descriptions: UndercoverDescription[];
  /** 本轮发言顺序（playerId 列表） */
  order: string[];
  /** 发言顺序游标 */
  orderCursor: number;
  votes: Record<string, string>;
  voteStatus: Record<string, 'voted' | 'abstained'>;
  /** 本轮被淘汰者 */
  eliminatedThisRound?: { playerId: string; role: UndercoverRole };
  /** 连续平票轮数（僵局检测） */
  consecutiveTies: number;
  winner?: 'civilians' | 'undercover';
  /** 全员可见的局势记忆 */
  publicNotes: UndercoverPublicNote[];
  /** 正在调用大模型生成发言的 AI 玩家（前端显示“正在输入”过渡） */
  typingPlayerId?: string | null;
  events: UndercoverGameEvent[];
}

export const UNDERCOVER_ROLE_LABELS: Record<UndercoverRole, string> = {
  civilian: '平民',
  undercover: '卧底',
};

export const UNDERCOVER_ROLE_DESCRIPTIONS: Record<UndercoverRole, string> = {
  civilian: '你和大多数人拿到同一个词。认真描述自己的词，找出描述不一致的卧底。',
  undercover: '你拿到的词和其他人略有不同。模糊描述、混淆视听，活到最后即可获胜。',
};

export const UNDERCOVER_PERSONA_DESCRIPTIONS: Record<UndercoverPersona, string> = {
  谨慎试探型: '发言偏保守，喜欢先给模糊提示，再慢慢补信息。',
  联想发散型: '喜欢从画面、情绪和场景联想切入，描述更有画面感。',
  稳健跟随型: '擅长顺着大多数人的方向补充，不轻易第一个跳出来。',
  大胆误导型: '更敢主动带偏角度，用听起来合理的说法制造混乱。',
};

/** 词库：相近但不同的词对（随机取一对，随机分配平民词/卧底词） */
export const WORD_PAIRS: [string, string][] = [
  ['可乐', '雪碧'],
  ['包子', '饺子'],
  ['牛奶', '豆浆'],
  ['洗发水', '沐浴露'],
  ['口红', '唇膏'],
  ['手机', '平板'],
  ['微信', 'QQ'],
  ['麦当劳', '肯德基'],
  ['火锅', '麻辣烫'],
  ['沙滩', '海边'],
  ['眼镜', '墨镜'],
  ['蝴蝶', '蜜蜂'],
  ['婚纱', '礼服'],
  ['钢琴', '电子琴'],
  ['篮球', '排球'],
  ['足球', '橄榄球'],
  ['电视', '电影'],
  ['小说', '漫画'],
  ['大学', '高中'],
  ['医生', '护士'],
  ['警察', '保安'],
  ['老师', '教授'],
  ['演员', '歌手'],
  ['台式机', '笔记本'],
  ['面条', '米线'],
  ['蛋炒饭', '扬州炒饭'],
  ['汉堡', '肉夹馍'],
  ['薯条', '薯片'],
  ['蛋糕', '面包'],
  ['咖啡', '奶茶'],
  ['矿泉水', '纯净水'],
  ['太阳', '月亮'],
  ['春天', '秋天'],
  ['圣诞节', '元旦'],
  ['火车站', '机场'],
  ['出租车', '网约车'],
  ['自行车', '电动车'],
  ['高铁', '飞机'],
  ['手表', '手环'],
  ['狮子', '老虎'],
  ['鲨鱼', '鲸鱼'],
  ['玫瑰', '月季'],
  ['苹果', '梨'],
  ['饺子', '馄饨'],
  ['眉毛', '睫毛'],
  ['枕头', '抱枕'],
  ['雨伞', '遮阳伞'],
  ['口红', '腮红'],
  ['拖鞋', '凉鞋'],
  ['教室', '自习室'],
];
