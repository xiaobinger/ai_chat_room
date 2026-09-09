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
} from './mystery-engine';
import { generateLlmSpeech } from './speech-generator';

const SPEECH_DEADLINE_MS = 60_000;
const SEARCH_DEADLINE_MS = 45_000;
const VOTE_DEADLINE_MS = 45_000;

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
      this.state = state as unknown as MysteryGameState;
    } else {
      this.state = initMysteryState(players.map((p) => ({ playerId: p.playerId, nickname: p.nickname })));
    }
  }

  getState(): Record<string, unknown> {
    return this.state as unknown as Record<string, unknown>;
  }

  isFinished(): boolean {
    return this.state.phase === 'reveal';
  }

  getResults(): Record<string, { won: boolean; role: string }> | null {
    if (!this.state.winner) return null;
    const winner = this.state.winner;
    const results: Record<string, { won: boolean; role: string }> = {};
    for (const p of this.state.players) {
      results[p.playerId] = {
        won: p.character.isMurderer ? winner === 'murderer' : winner === 'detectives',
        role: p.character.isMurderer ? '凶手' : p.character.isPolice ? (p.character.isCorrupt ? '黑警' : '警察') : p.character.name,
      };
    }
    // 彩蛋：无论胜负，最终真相大白——凶手（及黑警）终将伏法
    if (this.state.phase === 'reveal') {
      const murderer = this.state.players.find((p) => p.character.isMurderer);
      const corruptPolice = this.state.players.find((p) => p.character.isPolice && p.character.isCorrupt);
      let epilogue = `【彩蛋】天网恢恢，疏而不漏。${murderer?.character.name}虽${winner === 'murderer' ? '一度逃脱指控' : '被当场擒获'}，但在后续调查中，铁证如山，${murderer?.character.name}最终被绳之以法，受到了法律的严惩。`;
      if (corruptPolice) {
        epilogue += ` 而与凶手勾结的${corruptPolice.character.name}也因受贿、包庇罪被一并查处，锒铛入狱。`;
      }
      epilogue += ` ${this.state.victim}的在天之灵，终得告慰。`;
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
    return getPlayerView(this.state, playerId) as Record<string, unknown>;
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

  step(): boolean {
    const state = this.state;
    if (state.phase === 'reveal') return false;
    const alive = getAlivePlayers(state);

    switch (state.phase) {
      case 'introduction': {
        for (const p of alive) {
          if (this.isAi(p.playerId) && !p.hasSpoken) {
            this.state = addDiscussion(state, p.playerId, generateMysterySpeech(state, p, 'introduction'), 'statement');
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
        this.transition('discussion', '搜证结束，进入圆桌讨论');
        return true;
      }
      case 'discussion': {
        // 30% 概率触发悄悄话
        this.generateSecretChat();
        for (const p of alive) {
          if (this.isAi(p.playerId) && !p.hasSpoken) {
            this.state = addDiscussion(state, p.playerId, generateMysterySpeech(state, p, 'discussion'), 'statement');
            return true;
          }
        }
        if (alive.some((p) => !p.hasSpoken)) return false;
        this.transition('voting', '讨论结束，进入最终指认投票');
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
        return true;
      }
      default:
        return false;
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
            nickname: murderer.nickname,
            gameRole: `凶手（${murderer.character.name}，${murderer.character.role}）`,
            personality: murderer.character.personality,
            phase: '真相大白，凶手独白',
            round: state.round,
            recentEvents: state.discussionLog.slice(-5).map((d) => `${d.playerName}: ${d.content}`),
            timeoutMs: 30_000,
            customHint: `你是真正的凶手。现在真相大白，请做一个独白，包括：1.你的杀人动机 2.你如何策划的 3.作案经过 4.事后如何处理 5.你想对其他人说的话。要有情感深度。`,
          }),
          new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 30_000)),
        ]);

        if (monologueText) {
          // 解析 LLM 输出，按段落拆分
          const parts = monologueText.split(/[。！？]/).filter(Boolean);
          state.monologue = {
            motive: parts[0] ?? defaultMonologue.motive,
            planning: parts[1] ?? defaultMonologue.planning,
            execution: parts[2] ?? defaultMonologue.execution,
            aftermath: parts[3] ?? defaultMonologue.aftermath,
            finalWords: parts[4] ?? monologueText,
            emotion: murderer.character.personality.includes('冷静') ? 'calm' : 'bitter',
          };
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
