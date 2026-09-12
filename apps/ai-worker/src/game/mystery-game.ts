import type {
  MysteryGameState,
  MysteryPlayerState,
  DetectiveObservation,
  SecretConversation,
  MurdererMonologue,
  PlayerAnalysis,
} from './mystery-types';
import { GameError, type EngineAction, type GamePlayerInfo } from './errors';
import { BaseGameEngine } from './base-engine';
import {
  initMysteryState,
  getAlivePlayers,
  addDiscussion,
  skipDiscussion,
  searchRandomClue,
  applyMysteryVote,
  resolveMysteryVote,
  generateMysterySpeech,
  decideMysteryVote,
  getPlayerView,
  summarizeMysteryPublicNote,
} from './mystery-engine';
import { generateLlmSpeech, PHASE_CONTEXT } from './speech-generator';

/** 解析 LLM 输出的凶手独白，按【标签】提取各段落 */
function parseMonologueText(text: string, fallback: MurdererMonologue): MurdererMonologue {
  const extract = (label: string) => {
    // 匹配 【动机】xxx 或 【动机】 xxx 格式
    const match = text.match(new RegExp(`【${label}】\\s*([^【]+)`));
    return match ? match[1].trim() : '';
  };
  const motive = extract('动机') || fallback.motive;
  const planning = extract('策划') || fallback.planning;
  const execution = extract('作案') || fallback.execution;
  const aftermath = extract('善后') || fallback.aftermath;
  const finalWords = extract('遗言') || fallback.finalWords;
  const emotion: MurdererMonologue['emotion'] =
    murdererEmotionByPersonality(fallback.emotion, text);
  return { motive, planning, execution, aftermath, finalWords, emotion };
}

function murdererEmotionByPersonality(initial: MurdererMonologue['emotion'], text: string): MurdererMonologue['emotion'] {
  if (/悔过|忏悔|对不起|抱歉|罪有应得|我错了|我的错/.test(text)) return 'remorseful';
  if (/不后悔|你们错了|我没错|挑衅|我从不后悔/.test(text)) return 'defiant';
  if (/平静|淡定|无所谓|早有准备|冷静/.test(text)) return 'calm';
  if (/怨恨|仇恨|报复|不甘心|积怨/.test(text)) return 'bitter';
  if (/绝望|走投无路|被逼无奈|没办法/.test(text)) return 'desperate';
  return initial;
}

const SPEECH_DEADLINE_MS = 60_000;
const SEARCH_DEADLINE_MS = 45_000;
const VOTE_DEADLINE_MS = 45_000;

/** 生成随机多结局（每个结局逻辑不同但都符合案件设定） */
function generateEpilogues(props: {
  murdererName: string;
  victim: string;
  weapon: string;
  caught: boolean;
  corruptPoliceName?: string;
  accompliceName?: string;
  accompliceAlive?: boolean;
  latecomerName?: string;
  twistCount: number;
  monologue?: { finalWords: string; emotion: string };
}): string[] {
  const { murdererName, victim, weapon, caught, corruptPoliceName, accompliceName, accompliceAlive, latecomerName, twistCount } = props;

  if (caught) {
    const endings = [
      `【结案】${murdererName}被当场指认为凶手，铁证如山。在审讯室里，${murdererName}崩溃了，交代了用${weapon}杀害${victim}的全部经过。案件告破，正义得到了伸张。`,
      `【真相】${murdererName}的伪装在最后一刻崩塌。当众人将手铐戴上${murdererName}的手腕时，${murdererName}终于承认：${victim}的死，就是一场蓄谋已久的谋杀。`,
      `【落幕】${murdererName}面对众人的指控，出人意料地露出了微笑："你们猜对了。"一切的谜团就此解开，${victim}的冤魂得以安息。`,
      `【破案】经过层层推理，所有证据都指向${murdererName}。在无可辩驳的事实面前，${murdererName}低下了头，轻声说道："${victim}……对不起。"`,
    ];
    if (accompliceName) {
      endings.push(
        `【共犯落网】${murdererName}落网的同时，帮凶${accompliceName}也未能逃脱——正是TA在调查中一次次的"合理分析"，差点把所有人引向深渊。真相，从来不止一层。`,
        `【连环反转】${murdererName}交代了全部罪行，也供出了同伙${accompliceName}。这场谋杀不是一个人的作案，而是一场精心编排的双簧——你们每推翻一次结论，都在TA们的剧本之内。`,
      );
    }
    if (corruptPoliceName) {
      endings.push(
        `【黑幕】不仅${murdererName}被绳之以法，警方内部的黑警${corruptPoliceName}也一并落网。原来这对"警匪"早已勾结，但最终还是难逃法网。`,
      );
    }
    if (twistCount >= 2) {
      endings.push(
        `【抽丝剥茧】这起案件经历了${twistCount}次反转——时间线被推翻、伪证被揭穿、动机被动摇，但你们最终还是穿过了凶手布下的所有迷雾，把${murdererName}钉死在证据链的最后一环上。这才是真正的推理。`,
      );
    }
    if (latecomerName) {
      endings.push(
        `【关键证词】值得一提的是，中途赶到${latecomerName}带来的线索，成为锁定${murdererName}的最后一块拼图。如果TA没有出现，这桩案子也许永远不会水落石出。`,
      );
    }
    return endings;
  }

  const endings = [
    `【追凶】${murdererName}在最后一刻成功逃脱，但留下了致命的破绽。警方已经锁定目标，天罗地网已然布下……（未完待续）`,
    `【未落网】众人指认了错误的目标，${murdererName}趁乱消失在夜色中。但在${murdererName}的房间里，警方发现了一封未寄出的信，上面写着事情的真相……`,
    `【悬案】这起案件成了悬案，${murdererName}逍遥法外。直到三年后，一桩新的案件揭开了陈年的秘密……`,
    `【逃逸】${murdererName}利用众人争论的空档悄然离开。但天网恢恢，疏而不漏，${victim}的鬼魂似乎仍在注视着这一切……`,
  ];
  if (accompliceName) {
    endings.push(
      `【完美共谋】${murdererName}逃脱了。而在人群里，帮凶${accompliceName}${accompliceAlive ? '始终没有人怀疑过' : '虽然曾被投出，却至死没有供出真凶'}。这场谋杀的最可怕之处在于：它从头到尾有两个人在执行。`,
    );
  }
  if (corruptPoliceName) {
    endings.push(
      `【勾结】${murdererName}在黑警${corruptPoliceName}的掩护下顺利脱身。但这条利益链条迟早会断裂，两人都逃不过命运的安排……`,
    );
  }
  if (twistCount >= 2) {
    endings.push(
      `【迷雾终局】${twistCount}次反转耗尽了所有人的判断力——当真相被层层伪装包裹，坚持直觉反而成了最危险的选择。${murdererName}正是利用了这一点，笑着走出了最后的门。`,
    );
  }
  return endings;
}

/** 侦探观察素材池 */
const OBSERVABLE_BEHAVIORS = [
  { action: '频繁看手表，似乎在计算什么时间', implication: '可能在等待某个时机，或对时间线非常敏感', suspicious: true, delta: 1 },
  { action: '在讨论中一直回避与受害者有关的话题', implication: '可能在刻意隐藏与受害者的关系', suspicious: true, delta: 2 },
  { action: '手一直在发抖，即使拿着茶杯也在轻微晃动', implication: '极度紧张，可能做了亏心事', suspicious: true, delta: 2 },
  { action: '偷偷和某人交换了一个眼神', implication: '他们之间可能有秘密约定', suspicious: true, delta: 1 },
  { action: '听到关键线索时瞳孔明显收缩', implication: '这个线索对他有特殊意义', suspicious: true, delta: 1 },
  { action: '在案发现场非常熟悉地形，不用人带路', implication: '之前来过这里很多次', suspicious: false, delta: 0 },
  { action: '主动帮助整理证物，但碰过的东西位置都变了', implication: '可能在篡改或移动证据', suspicious: true, delta: 2 },
  { action: '发言时逻辑清晰，但总在下意识摸左手无名指', implication: '在隐瞒什么重要的事情', suspicious: true, delta: 1 },
  { action: '听到有人被怀疑时明显松了一口气', implication: '之前非常担心自己被怀疑', suspicious: true, delta: 1 },
  { action: '对在场每个人的行踪都了如指掌', implication: '一直在暗中观察所有人', suspicious: false, delta: 0 },
  { action: '在无人的时候偷偷翻看了某个抽屉', implication: '可能在寻找什么东西或销毁证据', suspicious: true, delta: 3 },
  { action: '鞋底有泥土，但声称一直待在室内', implication: '证词与实际行为矛盾', suspicious: true, delta: 2 },
];

/** 悄悄话素材池 */
const SECRET_CHAT_SCENARIOS = [
  { topic: '谈论不在场证明', lines: ['你当时真的在花园吗？', '……在的，怎么了？', '没什么，就是有人说你不在。'] },
  { topic: '讨论某个线索', lines: ['你看到那把钥匙了吗？', '……什么钥匙？', '算了，可能是我看错了。'] },
  { topic: '试探对方身份', lines: ['你以前来过这里吧？', '为什么这么说？', '你对这里太熟悉了。'] },
  { topic: '交换信息', lines: ['我注意到一件事，但不想公开说。', '……告诉我。', '那你先告诉我你发现了什么。'] },
  { topic: '警告', lines: ['有些事情不要说出去。', '你在威胁我？', '我是在提醒你。'] },
];

/** 剧本杀引擎 */
export class MysteryGame extends BaseGameEngine {
  private state: MysteryGameState;
  private speechProvider: import('../model-provider').ModelProvider | null = null;

  constructor(
    players: GamePlayerInfo[],
    state?: Record<string, unknown>,
    options?: { speechProvider?: import('../model-provider').ModelProvider },
  ) {
    super(players);
    this.speechProvider = options?.speechProvider ?? null;
    if (state) {
      if (state.format !== 2) throw new GameError('unsupported_state', '旧版本游戏状态无法恢复');
      const restored = state as unknown as MysteryGameState;
      // 跨版本恢复补全：新增的可选字段在旧存档中不存在，这里统一补默认值
      this.state = {
        ...restored,
        twists: restored.twists ?? [],
        latecomerPool: restored.latecomerPool ?? [],
        conflictLevel: restored.conflictLevel ?? 0,
        conflictEvents: restored.conflictEvents ?? [],
      };
    } else {
      this.state = initMysteryState(players.map((p) => ({ playerId: p.playerId, nickname: p.nickname })));
    }
  }

  getState(): Record<string, unknown> {
    return this.state as unknown as Record<string, unknown>;
  }

  /** 中途彩蛋入场的 NPC（npc- 前缀）不在房间玩家表里，但由引擎 AI 自动接管发言 */
  protected isAi(playerId: string): boolean {
    if (playerId.startsWith('npc-')) return true;
    return super.isAi(playerId);
  }

  isFinished(): boolean {
    return this.state.phase === 'reveal';
  }

  getResults(): Record<string, { won: boolean; role: string }> | null {
    if (!this.state.winner) return null;
    const winner = this.state.winner;
    const results: Record<string, { won: boolean; role: string }> = {};
    for (const p of this.state.players) {
      if (p.character.isMurderer) {
        results[p.playerId] = { won: winner === 'murderer', role: '凶手' };
      } else if (p.character.isAccomplice) {
        // 帮凶与凶手共生死：真凶逃脱则共谋得逞；帮凶曾被投出（已出局）也随真凶一同伏法
        results[p.playerId] = { won: winner === 'murderer' && p.isAlive, role: '帮凶' };
      } else if (p.character.isPolice) {
        results[p.playerId] = { won: winner === 'detectives', role: p.character.isCorrupt ? '黑警' : '警察' };
      } else {
        results[p.playerId] = { won: winner === 'detectives', role: p.character.name };
      }
    }
    // 随机多结局：根据凶手是否被抓住 + 帮凶/黑警 + 反转次数 + 随机叙事风格生成不同结局
    if (this.state.phase === 'reveal') {
      const murderer = this.state.players.find((p) => p.character.isMurderer);
      const corruptPolice = this.state.players.find((p) => p.character.isPolice && p.character.isCorrupt);
      const accomplice = this.state.players.find((p) => p.character.isAccomplice);
      const latecomer = this.state.players.find((p) => p.isLatecomer);
      const caught = winner === 'detectives';

      const endings = generateEpilogues({
        murdererName: murderer?.character.name ?? '凶手',
        victim: this.state.victim,
        weapon: this.state.murderWeapon,
        caught,
        accompliceName: accomplice?.character.name,
        accompliceAlive: accomplice?.isAlive,
        latecomerName: latecomer?.character.name,
        twistCount: this.state.twists.length,
        corruptPoliceName: corruptPolice?.character.name,
        monologue: this.state.monologue,
      });

      const epilogue = endings[Math.floor(Math.random() * endings.length)];
      this.state.events.push({
        id: crypto.randomUUID(),
        round: this.state.round,
        phase: 'reveal',
        type: 'game_end',
        content: epilogue,
        timestamp: Date.now(),
      });
    }
    return results;
  }

  getView(playerId: string | null, _isJudge?: boolean): Record<string, unknown> {
    return { ...getPlayerView(this.state, playerId), hostedPlayers: Array.from(this.hostedPlayers) } as Record<string, unknown>;
  }

  getRoles(): Record<string, string> {
    const roles: Record<string, string> = {};
    for (const p of this.state.players) roles[p.playerId] = p.character.name;
    return roles;
  }

  phaseDeadlineMs(): number {
    switch (this.state.phase) {
      case 'introduction':
      case 'discussion':
      case 'accusation':
        return SPEECH_DEADLINE_MS;
      case 'investigation':
        return SEARCH_DEADLINE_MS;
      default:
        return VOTE_DEADLINE_MS;
    }
  }

  pendingHumans(): string[] {
    const state = this.state;
    if (state.phase === 'reveal') return [];
    const alive = getAlivePlayers(state);

    switch (state.phase) {
      case 'introduction':
      case 'discussion':
      case 'accusation':
        return alive
          .filter((p) => !this.isAi(p.playerId) && !p.hasSpoken)
          .map((p) => p.playerId);
      case 'investigation':
        return alive
          .filter((p) => !this.isAi(p.playerId) && !p.hasSearched)
          .map((p) => p.playerId);
      case 'voting':
        return alive
          .filter((p) => !this.isAi(p.playerId) && !state.voteStatus[p.playerId])
          .map((p) => p.playerId);
      default:
        return [];
    }
  }

  handleAction(action: EngineAction): void {
    switch (action.type) {
      case 'speak':
        this.state = addDiscussion(this.state, action.playerId, action.content ?? '', 'statement');
        return;
      case 'speak_skip':
        this.state = skipDiscussion(this.state, action.playerId);
        return;
      case 'search': {
        const me = this.requireAliveInvestigator(action.playerId);
        if (me.hasSearched) throw new GameError('already_searched', '本轮已搜证');
        const next = searchRandomClue(this.state, action.playerId);
        // 无论是否发现新线索，搜证机会都已消耗
        next.players.find((p) => p.playerId === action.playerId)!.hasSearched = true;
        this.state = next;
        return;
      }
      case 'vote':
        this.state = applyMysteryVote(this.state, action.playerId, action.targetId ?? null);
        return;
      case 'vote_abstain':
        this.state = applyMysteryVote(this.state, action.playerId, null);
        return;
      case 'host_ai':
        this.setHostAi(action.playerId, true);
        return;
      case 'unhost_ai':
        this.setHostAi(action.playerId, false);
        return;
      default:
        throw new GameError('unknown_action', `未知动作：${action.type}`);
    }
  }

  private requireAliveInvestigator(playerId: string): MysteryPlayerState {
    const me = this.state.players.find((p) => p.playerId === playerId);
    if (!me) throw new GameError('player_not_found', '玩家不存在');
    if (!me.isAlive) throw new GameError('player_dead', '你已出局');
    if (this.state.phase !== 'investigation') throw new GameError('not_investigation', '当前不是搜证阶段');
    return me;
  }

  autoAct(playerId: string): void {
    const state = this.state;
    const me = state.players.find((p) => p.playerId === playerId);
    if (!me || !me.isAlive) return;

    switch (state.phase) {
      case 'introduction':
      case 'discussion':
      case 'accusation':
        if (!me.hasSpoken) this.state = skipDiscussion(state, playerId);
        return;
      case 'investigation':
        if (!me.hasSearched) this.handleAction({ type: 'search', playerId });
        return;
      case 'voting':
        if (!state.voteStatus[playerId]) {
          this.state = applyMysteryVote(state, playerId, null);
        }
        return;
      default:
        return;
    }
  }

  async step(): Promise<boolean> {
    const state = this.state;
    if (state.phase === 'reveal') return false;
    const alive = getAlivePlayers(state);

    // 第二阶段：真正调用大模型生成发言
    if (state.typingPlayerId) {
      const pendingId = state.typingPlayerId;
      state.typingPlayerId = null;
      const p = state.players.find((x) => x.playerId === pendingId);
      if (p && this.isAi(p.playerId) && !p.hasSpoken && this.isSpeechPhase(state.phase)) {
        await this.speakFor(p, state.phase);
        return true;
      }
    }

    switch (state.phase) {
      case 'introduction': {
        for (const p of alive) {
          if (this.isAi(p.playerId) && !p.hasSpoken) {
            if (this.speechProvider) {
              this.state.typingPlayerId = p.playerId;
              return true;
            }
            this.state = addDiscussion(state, p.playerId, generateMysterySpeech(this.state, p, 'introduction'), 'statement');
            return true;
          }
        }
        if (alive.some((p) => !p.hasSpoken)) return false;
        this.transition('investigation', '自我介绍结束，进入搜证阶段');
        return true;
      }
      case 'investigation': {
        // 侦探观察
        this.generateObservations();
        for (const p of alive) {
          if (this.isAi(p.playerId) && !p.hasSearched) {
            this.state = searchRandomClue(state, p.playerId);
            // searchRandomClue 不会标记 hasSearched（discoverClue 只管线索），这里补上
            this.state.players.find((x) => x.playerId === p.playerId)!.hasSearched = true;
            return true;
          }
        }
        if (alive.some((p) => !p.hasSearched)) return false;
        // 重置发言状态，进入讨论
        for (const p of state.players) p.hasSpoken = false;
        const note = summarizeMysteryPublicNote(this.state);
        if (note) this.state.publicNotes.push({ round: this.state.round, content: note });
        this.transition('discussion', `搜证结束。请各位围绕案发现场、凶器和彼此证词展开圆桌讨论。`);
        return true;
      }
      case 'discussion': {
        // 30% 概率触发悄悄话
        this.generateSecretChat();
        for (const p of alive) {
          if (this.isAi(p.playerId) && !p.hasSpoken) {
            if (this.speechProvider) {
              this.state.typingPlayerId = p.playerId;
              return true;
            }
            this.state = addDiscussion(state, p.playerId, generateMysterySpeech(this.state, p, 'discussion'), 'statement');
            return true;
          }
        }
        if (alive.some((p) => !p.hasSpoken)) return false;
        for (const p of state.players) p.hasSpoken = false;
        const note = summarizeMysteryPublicNote(this.state);
        if (note) this.state.publicNotes.push({ round: this.state.round, content: `圆桌讨论后的共识：${note}` });
        this.transition('accusation', '自由讨论结束。现在进入公开指控环节，请每个人给出最终怀疑对象和理由。');
        return true;
      }
      case 'accusation': {
        for (const p of alive) {
          if (this.isAi(p.playerId) && !p.hasSpoken) {
            if (this.speechProvider) {
              this.state.typingPlayerId = p.playerId;
              return true;
            }
            this.state = addDiscussion(state, p.playerId, generateMysterySpeech(this.state, p, 'accusation'), 'accusation');
            return true;
          }
        }
        if (alive.some((p) => !p.hasSpoken)) return false;
        const note = summarizeMysteryPublicNote(this.state);
        if (note) this.state.publicNotes.push({ round: this.state.round, content: `进入投票前，场上判断：${note}` });
        this.transition('voting', '公开指控结束，进入最终指认投票。请慎重投出决定案件走向的一票。');
        return true;
      }
      case 'voting': {
        for (const p of alive) {
          if (this.isAi(p.playerId) && !state.voteStatus[p.playerId]) {
            const { targetId } = decideMysteryVote(state, p);
            this.state = applyMysteryVote(state, p.playerId, targetId);
            return true;
          }
        }
        if (alive.some((p) => !state.voteStatus[p.playerId])) return false;
        this.state = resolveMysteryVote(state);
        // 进入真相揭晓阶段后，生成凶手独白（与玩家视角同步）
        if (this.state.phase === 'reveal') {
          await this.generateMonologue();
        }
        return true;
      }
      default:
        return false;
    }
  }

  private isSpeechPhase(phase: MysteryGameState['phase']): phase is 'introduction' | 'discussion' | 'accusation' {
    return phase === 'introduction' || phase === 'discussion' || phase === 'accusation';
  }

  /** 为单个 AI 生成发言：大模型成功则发言，失败/超时/空响应回退模板，尽量不沉默 */
  private async speakFor(player: MysteryPlayerState, type: 'introduction' | 'discussion' | 'accusation'): Promise<void> {
    if (!this.speechProvider) {
      this.state = addDiscussion(this.state, player.playerId, generateMysterySpeech(this.state, player, type), type === 'accusation' ? 'accusation' : 'statement');
      return;
    }

    const recentEvents = [
      ...this.state.publicNotes.slice(-2).map((note) => note.content),
      ...this.state.discussionLog.slice(-5).map((entry) => `${entry.playerName}: ${entry.content}`),
      ...this.state.clues
        .filter((clue) => this.state.discoveredClues.includes(clue.id))
        .slice(-2)
        .map((clue) => `线索【${clue.name}】：${clue.revealsInfo}`),
    ];
    const phaseLabel =
      type === 'introduction' ? '自我介绍' : type === 'discussion' ? '圆桌讨论' : '公开指控';
    const customHint = player.character.isMurderer
      ? `你是真正的凶手，要像真人一样自然回应，尽量引导怀疑去别人身上。`
      : player.character.isAccomplice
        ? `你是凶手的帮凶（身份对其他人隐藏）。你要表现得像一个认真推理的好人，但你的目标是暗中把怀疑引向无辜者、为真凶解围。发言要自然可信，绝不能暴露你是帮凶。如果讨论中有人指向真凶，你要用"合情合理"的方式转移火力；如果证据链快连上，你要设法制造新的疑点。`
        : `你不是凶手，请结合自己的人设、线索和讨论内容，认真推动破案。`;

    // 收集该角色之前的发言，用于防重复
    const ownPreviousSpeeches = this.state.discussionLog
      .filter((entry) => entry.playerId === player.playerId)
      .map((entry) => entry.content);

    const llmSpeech = await generateLlmSpeech(this.speechProvider, {
      game: 'murder_mystery',
      nickname: player.nickname,
      gameRole: `${player.character.name}（${player.character.role}）`,
      personality: player.character.personality,
      gender: player.character.gender,
      voiceProfile: {
        gender: player.character.gender,
        age: player.character.age,
        height: player.character.height,
        weight: player.character.weight,
        personality: player.character.personality,
      },
      phase: phaseLabel,
      context: PHASE_CONTEXT[this.state.phase] ?? 'calm',
      round: this.state.round,
      recentEvents,
      ownPreviousSpeeches,
      timeoutMs: 30_000,
      customHint,
    });

    if (llmSpeech && llmSpeech.trim().length >= 2) {
      this.state = addDiscussion(this.state, player.playerId, llmSpeech, type === 'accusation' ? 'accusation' : 'statement');
    } else {
      // 大模型不可用/超时/空响应：回退模板发言，避免 AI 集体沉默
      this.state = addDiscussion(this.state, player.playerId, generateMysterySpeech(this.state, player, type), type === 'accusation' ? 'accusation' : 'statement');
    }
  }

  private transition(phase: MysteryGameState['phase'], message: string): void {
    this.state.phase = phase;
    this.state.events.push({
      id: crypto.randomUUID(),
      round: this.state.round,
      phase,
      type: 'phase_change',
      content: message,
      timestamp: Date.now(),
    });
  }

  /** 侦探/警察每轮自动观察其他玩家 */
  private generateObservations(): void {
    const state = this.state;
    const police = state.players.find((p) => p.character.isPolice);
    if (!police?.isAlive) return;

    const targets = getAlivePlayers(state).filter((p) => p.playerId !== police.playerId);
    if (targets.length === 0) return;

    // 每轮观察 1-2 个玩家
    const observeCount = Math.min(1 + Math.floor(Math.random() * 2), targets.length);
    const shuffled = [...targets].sort(() => Math.random() - 0.5);

    for (let i = 0; i < observeCount; i++) {
      const target = shuffled[i];
      const behavior = OBSERVABLE_BEHAVIORS[Math.floor(Math.random() * OBSERVABLE_BEHAVIORS.length)];

      const observation: DetectiveObservation = {
        id: crypto.randomUUID(),
        round: state.round,
        observerId: police.playerId,
        targetId: target.playerId,
        targetName: target.nickname,
        behavior: behavior.action,
        deduction: `${behavior.action}——${behavior.implication}`,
        suspicious: behavior.suspicious,
        suspicionDelta: behavior.delta,
        timestamp: Date.now(),
      };

      state.observations.push(observation);

      // 更新嫌疑值
      target.suspicionLevel += behavior.delta;

      // 记录事件（仅侦探可见）
      state.events.push({
        id: crypto.randomUUID(),
        round: state.round,
        phase: state.phase,
        type: 'observation',
        actorName: police.nickname,
        content: `【观察】${target.nickname}：${behavior.action}。${behavior.implication}`,
        timestamp: Date.now(),
        visibleTo: [police.playerId],
      });
    }
  }

  /** 随机生成两个角色之间的悄悄话 */
  private generateSecretChat(): void {
    const state = this.state;
    const alive = getAlivePlayers(state);
    if (alive.length < 2) return;

    // 30% 概率触发悄悄话
    if (Math.random() > 0.3) return;

    const shuffled = [...alive].sort(() => Math.random() - 0.5);
    const a = shuffled[0];
    const b = shuffled[1];

    const scenario = SECRET_CHAT_SCENARIOS[Math.floor(Math.random() * SECRET_CHAT_SCENARIOS.length)];
    const chatId = crypto.randomUUID();

    const conversation: SecretConversation = {
      id: chatId,
      round: state.round,
      participantA: a.playerId,
      participantB: b.playerId,
      messages: scenario.lines.map((line, i) => ({
        speaker: i % 2 === 0 ? a.nickname : b.nickname,
        content: line,
      })),
      summary: `${a.nickname} 与 ${b.nickname} 私下讨论了：${scenario.topic}`,
      isKey: Math.random() < 0.3,
    };

    state.secretChats.push(conversation);

    state.events.push({
      id: crypto.randomUUID(),
      round: state.round,
      phase: state.phase,
      type: 'secret_chat',
      content: `【悄悄话】${a.nickname} 与 ${b.nickname} 进行了一次私下交流…`,
      timestamp: Date.now(),
    });
  }

  /** 真相大白时生成凶手独白 */
  private async generateMonologue(): Promise<void> {
    const state = this.state;
    const murderer = state.players.find((p) => p.character.isMurderer);
    if (!murderer) return;

    const defaultMonologue: MurdererMonologue = {
      motive: `我对${state.victim}积怨已久，他毁掉了我的一切。`,
      planning: `我花了很多天观察他的作息，摸清了每个人的行动规律。`,
      execution: `那天晚上，我趁所有人不注意，用${state.murderWeapon}结束了他的生命。`,
      aftermath: `我冷静地处理了现场，销毁了所有证据，然后假装一切正常。`,
      finalWords: `你们以为抓到我了？不，是你们从一开始就错了。我从不后悔。`,
      emotion: 'defiant',
    };

    // 尝试用 LLM 生成更丰富的独白
    if (this.speechProvider) {
      try {
        const monologueText = await Promise.race([
          generateLlmSpeech(this.speechProvider, {
            game: 'murder_mystery',
            nickname: murderer.nickname,
            gameRole: `凶手（${murderer.character.name}，${murderer.character.role}）`,
            personality: murderer.character.personality,
            phase: '真相大白，凶手独白',
            round: state.round,
            recentEvents: state.discussionLog.slice(-5).map((d) => `${d.playerName}: ${d.content}`),
            timeoutMs: 30_000,
            customHint: `你是真正的凶手，你杀害了${state.victim}，凶器是${state.murderWeapon}，案发地点是${state.crimeScene}。现在真相大白，请以第一人称做一段凶手独白，必须严格包含以下五个部分，每部分用【】标签开头：【动机】你的杀人动机【策划】你如何精心策划【作案】作案经过【善后】事后如何处理【遗言】你想对其他人说的话。要有情感深度，贴合你的性格（${murderer.character.personality}），每部分 1-2 句话。`,
          }),
          new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 30_000)),
        ]);

        if (monologueText) {
          const parsed = parseMonologueText(monologueText, defaultMonologue);
          state.monologue = parsed;
        } else {
          state.monologue = defaultMonologue;
        }
      } catch {
        state.monologue = defaultMonologue;
      }
    } else {
      state.monologue = defaultMonologue;
    }

    // 记录独白事件
    state.events.push({
      id: crypto.randomUUID(),
      round: state.round,
      phase: 'reveal',
      type: 'monologue',
      actorName: murderer.nickname,
      characterName: murderer.character.name,
      content: `【凶手独白】${state.monologue.finalWords}`,
      timestamp: Date.now(),
    });
  }

  /** 构建 detailed replay 数据 */
  private buildReplay(): void {
    const state = this.state;
    if (!state.monologue) return;

    const murderer = state.players.find((p) => p.character.isMurderer);
    if (!murderer) return;

    const playerAnalyses: PlayerAnalysis[] = state.players.map((p) => {
      const observationsAbout = state.observations
        .filter((o) => o.targetId === p.playerId)
        .map((o) => `${o.behavior}（${o.deduction}）`);

      return {
        playerId: p.playerId,
        nickname: p.nickname,
        characterName: p.character.name,
        characterRole: p.character.role,
        wasMurderer: p.character.isMurderer,
        wasPolice: p.character.isPolice ?? false,
        wasCorrupt: p.character.isCorrupt ?? false,
        realRelationships: [p.character.relationshipToVictim],
        claimedVsReal: (p.character.claimedRelationships ?? []).map((rc) => ({
          claimed: `声称与${rc.targetName}是${rc.relationship}`,
          real: rc.isTrue ? '属实' : '编造',
        })),
        objectives: p.character.objectives.map((o) => ({
          description: o.description,
          completed: p.completedObjectives.includes(o.description),
        })),
        keyStatements: state.discussionLog
          .filter((d) => d.playerId === p.playerId && (d.type === 'accusation' || d.type === 'defense'))
          .slice(-3)
          .map((d) => d.content),
        motive: {
          playerId: p.playerId,
          characterName: p.character.name,
          nickname: p.nickname,
          surfaceMotive: p.character.relationshipToVictim,
          hiddenMotive: p.character.isMurderer ? state.monologue?.motive : undefined,
          strength: p.character.isMurderer ? 5 : Math.min(5, 1 + p.suspicionLevel),
        },
        observationsAbout,
        finalVerdict: p.character.isMurderer
          ? '凶手——精心策划了这场谋杀，但最终难逃法网'
          : p.character.isPolice
            ? (p.character.isCorrupt ? '黑警——与凶手勾结，玷污了警徽' : '尽职的侦探——抽丝剥茧，接近真相')
            : '无辜者——在这场悲剧中被卷入漩涡',
      };
    });

    state.replay = {
      scenarioTitle: state.scenarioTitle ?? '未知剧本',
      victim: state.victim,
      crimeScene: state.crimeScene,
      murderWeapon: state.murderWeapon,
      duration: `约 ${state.round} 轮`,
      murdererId: state.murdererId,
      murdererName: murderer.nickname,
      murdererCharacter: murderer.character.name,
      murdererMonologue: state.monologue,
      truth: {
        motive: state.monologue.motive,
        timeline: state.events
          .filter((e) => e.type === 'phase_change' || e.type === 'player_action')
          .map((e) => `第${e.round}轮: ${e.content}`),
        method: `使用${state.murderWeapon}在${state.crimeScene}作案`,
        keyEvidence: state.clues.filter((c) => c.isKey && state.discoveredClues.includes(c.id)).map((c) => c.revealsInfo),
      },
      playerAnalyses,
      detectiveObservations: state.observations,
      secretConversations: state.secretChats,
      clueAnalysis: state.clues.map((c) => ({
        clue: c,
        significance: c.revealsInfo,
        pointedTo: c.isKey ? murderer.character.name : '不直接指向任何人',
      })),
      winner: state.winner ?? 'unknown',
      correctAccusation: state.accusedMurdererId === state.murdererId,
    };
  }
}
