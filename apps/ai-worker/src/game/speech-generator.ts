import { ModelCallError, type ModelProvider } from '../model-provider';

/** 角色性别：影响 TTS 音色和语言风格 */
export type CharacterGender = 'male' | 'female' | 'unknown';

/**
 * 角色生理特征——用于音色差异化算法
 *
 * 音色映射原理：
 * - 性别：男声低沉（低 pitch），女声清亮（高 pitch）
 * - 年龄：年幼→偏高偏快（稚嫩），年老→偏低偏慢（苍老）
 * - 身高：高个→低 pitch（共鸣腔大），矮个→高 pitch（共鸣腔小）
 * - 体重：重→低 pitch + 高音量（浑厚有力），轻→高 pitch + 低音量（单薄纤细）
 */
export interface VoiceProfile {
  gender?: CharacterGender;
  age?: number;
  height?: number;   // cm
  weight?: number;   // kg
  personality?: string;
}

/**
 * 语境类型——当前游戏阶段的氛围/情绪
 * 影响发言的语调和节奏
 */
export type VoiceContext =
  | 'mysterious'   // 神秘：序幕阶段，缓慢、低沉、悬疑
  | 'tense'        // 紧张：调查阶段，急促、压低、警觉
  | 'contemplative' // 沉思： discussion阶段，平稳、理性、有停顿
  | 'passionate'   // 激情：指控阶段、高亢、激动、有力
  | 'suspenseful'  // 悬疑：投票阶段、犹豫、迟疑、不确定
  | 'climactic'    // 高潮：揭晓阶段、强烈、顿挫、戏剧性
  | 'calm';         // 平静：默认状态

/** 游戏发言生成的通用请求 */
export interface GameSpeechRequest {
  /** 游戏类型 */
  game: string;
  /** 玩家昵称 */
  nickname: string;
  /** 游戏内身份（狼人/预言家/小偷/侦探/剧本杀角色名...） */
  gameRole: string;
  /** 性格描述 */
  personality: string;
  /** 角色性别 */
  gender?: CharacterGender;
  /** 角色生理特征（年龄/身高/体重） */
  voiceProfile?: VoiceProfile;
  /** 当前阶段 */
  phase: string;
  /** 当前语境/氛围（影响语调） */
  context?: VoiceContext;
  /** 轮次 */
  round: number;
  /** 最近对话/事件（上下文感知用） */
  recentEvents: string[];
  /** 该角色之前的发言（防重复） */
  ownPreviousSpeeches?: string[];
  /** 超时 */
  timeoutMs: number;
  /** 自定义提示（剧本杀任务等） */
  customHint?: string;
}

/** 音色参数——用于前端 SpeechSynthesisUtterance */
export interface VoiceParams {
  pitch: number;    // 0.0 ~ 2.0（音高，1.0 为默认）
  rate: number;     // 0.1 ~ 10.0（语速，1.0 为默认）
  volume: number;   // 0.0 ~ 1.0（音量）
}

/**
 * 阶段→语境映射：自动根据游戏阶段选择语境
 */
export const PHASE_CONTEXT: Record<string, VoiceContext> = {
  introduction: 'mysterious',
  investigation: 'tense',
  discussion: 'contemplative',
  accusation: 'passionate',
  voting: 'suspenseful',
  reveal: 'climactic',
};

/**
 * 音色参数计算——综合角色生理特征 + 性格 + 语境
 *
 * 算法说明：
 * 1. 基准值：pitch=1.0, rate=1.0, volume=1.0
 * 2. 性别调整：男 -0.25/+0.12，女 +0.25/+0.05
 * 3. 年龄调整：以 30 岁为基准，每偏离 10 岁 pitch ∓0.04，rate ∓0.03
 * 4. 身高调整：以 170cm 为基准，每偏离 10cm pitch ∓0.03
 * 5. 体重调整：以 70kg 为基准，每偏离 10kg volume ±0.05，pitch ∓0.02
 * 6. 性格微调：±0.05~0.1
 * 7. 语境微调：根据当前氛围进一步调整
 *
 * 输出范围限制：
 * - pitch: [0.5, 1.5]
 * - rate: [0.7, 1.3]
 * - volume: [0.4, 1.0]
 */
export function computeVoiceParams(
  profile: VoiceProfile | undefined,
  context: VoiceContext | undefined,
): VoiceParams {
  if (!profile) {
    return applyContext({ pitch: 1.0, rate: 1.0, volume: 1.0 }, context);
  }

  const { gender, age, height, weight, personality } = profile;

  // 1. 性别基准
  let pitch = 1.0;
  let rate = 1.0;
  let volume = 1.0;

  if (gender === 'male') {
    pitch -= 0.25;
    rate -= 0.12;
    volume += 0.05;
  } else if (gender === 'female') {
    pitch += 0.25;
    rate += 0.05;
    volume -= 0.02;
  }

  // 2. 年龄调整（以 30 岁为基准）
  if (age !== undefined && !isNaN(age)) {
    const ageDelta = (age - 30) / 10;
    pitch -= ageDelta * 0.04;
    rate -= ageDelta * 0.03;
    if (age > 60) {
      rate -= 0.05;
      pitch -= 0.03;
    } else if (age < 18) {
      pitch += 0.05;
      rate += 0.05;
    }
  }

  // 3. 身高调整（以 170cm 为基准，影响共鸣感）
  if (height !== undefined && !isNaN(height)) {
    const heightDelta = (height - 170) / 10;
    pitch -= heightDelta * 0.03;
    volume += heightDelta * 0.02;
  }

  // 4. 体重调整（以 70kg 为基准，影响厚度）
  if (weight !== undefined && !isNaN(weight)) {
    const weightDelta = (weight - 70) / 10;
    volume += weightDelta * 0.05;
    pitch -= weightDelta * 0.02;
    if (weight > 90) {
      rate -= 0.03;
    } else if (weight < 50) {
      rate += 0.03;
    }
  }

  // 5. 性格微调
  if (personality) {
    if (/豪爽|直率|暴躁|果断|强势|霸气/.test(personality)) {
      rate = Math.min(1.3, rate + 0.08);
      pitch = Math.max(0.5, pitch - 0.06);
      volume = Math.min(1.0, volume + 0.05);
    } else if (/谨慎|冷静|沉稳|理性|专业|内敛/.test(personality)) {
      rate = Math.max(0.7, rate - 0.08);
      pitch = Math.max(0.5, pitch - 0.04);
    } else if (/敏感|温柔|胆小|内向|善良|忧郁|细腻/.test(personality)) {
      pitch = Math.min(1.5, pitch + 0.06);
      rate = Math.max(0.7, rate - 0.04);
      volume = Math.max(0.4, volume - 0.05);
    } else if (/精明|圆滑|狡诈|狡猾|城府/.test(personality)) {
      rate = Math.min(1.3, rate + 0.05);
      pitch = Math.max(0.5, pitch - 0.03);
    } else if (/威严|霸气|高贵|强势/.test(personality)) {
      volume = Math.min(1.0, volume + 0.08);
      pitch = Math.max(0.5, pitch - 0.05);
      rate = Math.max(0.7, rate - 0.05);
    } else if (/活泼|外向|俏皮|开朗/.test(personality)) {
      rate = Math.min(1.3, rate + 0.06);
      pitch = Math.min(1.5, pitch + 0.04);
    } else if (/阴郁|沉默|木讷|内向/.test(personality)) {
      rate = Math.max(0.7, rate - 0.06);
      pitch = Math.max(0.5, pitch - 0.02);
      volume = Math.max(0.4, volume - 0.03);
    }
  }

  return applyContext(
    {
      pitch: clamp(Math.round(pitch * 100) / 100, 0.5, 1.5),
      rate: clamp(Math.round(rate * 100) / 100, 0.7, 1.3),
      volume: clamp(Math.round(volume * 100) / 100, 0.4, 1.0),
    },
    context,
  );
}

/** 语境微调参数 */
function applyContext(params: VoiceParams, context: VoiceContext | undefined): VoiceParams {
  const p = { ...params };

  switch (context) {
    case 'mysterious':
      p.pitch = clamp(p.pitch - 0.05, 0.5, 1.5);
      p.rate = clamp(p.rate - 0.08, 0.7, 1.3);
      p.volume = clamp(p.volume - 0.05, 0.4, 1.0);
      break;
    case 'tense':
      p.rate = clamp(p.rate + 0.05, 0.7, 1.3);
      p.pitch = clamp(p.pitch + 0.03, 0.5, 1.5);
      p.volume = clamp(p.volume - 0.03, 0.4, 1.0);
      break;
    case 'contemplative':
      p.rate = clamp(p.rate - 0.05, 0.7, 1.3);
      p.pitch = clamp(p.pitch - 0.02, 0.5, 1.5);
      break;
    case 'passionate':
      p.pitch = clamp(p.pitch + 0.08, 0.5, 1.5);
      p.rate = clamp(p.rate + 0.05, 0.7, 1.3);
      p.volume = clamp(p.volume + 0.1, 0.4, 1.0);
      break;
    case 'suspenseful':
      p.rate = clamp(p.rate - 0.1, 0.7, 1.3);
      p.pitch = clamp(p.pitch - 0.03, 0.5, 1.5);
      p.volume = clamp(p.volume - 0.05, 0.4, 1.0);
      break;
    case 'climactic':
      p.pitch = clamp(p.pitch + 0.05, 0.5, 1.5);
      p.rate = clamp(p.rate - 0.03, 0.7, 1.3);
      p.volume = clamp(p.volume + 0.05, 0.4, 1.0);
      break;
    case 'calm':
    default:
      break;
  }

  return {
    pitch: Math.round(p.pitch * 100) / 100,
    rate: Math.round(p.rate * 100) / 100,
    volume: Math.round(p.volume * 100) / 100,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 用 LLM 生成游戏发言——替代固定模板，让 AI 像真人一样说话。
 * LLM 不可用/超时/空响应时返回 null，调用方回退到模板。
 *
 * 实测教训（WP20）：自建端点的 auto 路由会间歇性返回空 content
 * （token 额度被后端隐藏推理耗尽，max_tokens 偏小时高概率必现），
 * 成功响应也可能耗时近 30s。因此：
 * - maxTokens 给足 800，给隐藏推理留出余量；
 * - 空响应/接口错误时原地重试一次（这类失败返回快，重试性价比高）；
 * - 超时不重试（时间预算已耗尽，重试只会拖慢对局节奏）。
 */
export async function generateLlmSpeech(
  provider: ModelProvider,
  request: GameSpeechRequest,
): Promise<string | null> {
  const first = await attemptLlmSpeech(provider, request);
  if (first.text) return cleanupSpeech(first.text);
  if (first.timedOut) return null;
  const second = await attemptLlmSpeech(provider, request);
  return second.text ? cleanupSpeech(second.text) : null;
}

function logGameLlm(stage: 'request' | 'success' | 'fallback', payload: Record<string, unknown>): void {
  const line = JSON.stringify(payload);
  console.warn(`[game-llm] ${stage} ${line}`);
}

/** 单次尝试：返回发言文本；失败返回 null 并标注是否为超时（决定是否重试） */
async function attemptLlmSpeech(
  provider: ModelProvider,
  request: GameSpeechRequest,
): Promise<{ text: string | null; timedOut: boolean }> {
  const systemPrompt = buildSystemPrompt(request);
  const userPrompt = buildUserPrompt(request);
  const meta = {
    game: request.game,
    provider: provider.name,
    nickname: request.nickname,
    role: request.gameRole,
    phase: request.phase,
    round: request.round,
  };

  logGameLlm('request', meta);

  try {
    const result = await provider.speak({
      roleName: `${request.nickname}（${request.gameRole}）`,
      systemPrompt,
      topic: userPrompt,
      context: request.recentEvents.slice(0, 8).map((content, i) => ({
        sequence: i + 1,
        speaker: i % 2 === 0 ? '玩家A' : '玩家B',
        content,
        roleId: null,
      })),
      maxTokens: 800,
      timeoutMs: request.timeoutMs,
    });
    const text = result.text.trim();
    if (!text || text.length < 2) {
      logGameLlm('fallback', { ...meta, reason: 'empty_response' });
      return { text: null, timedOut: false };
    }
    logGameLlm('success', { ...meta, length: text.length, tokens: result.tokens, tokensMeasured: result.tokensMeasured });
    return { text, timedOut: false };
  } catch (error) {
    const timedOut = error instanceof ModelCallError && error.kind === 'timeout';
    logGameLlm('fallback', {
      ...meta,
      reason: timedOut ? 'timeout' : 'provider_error',
      message: error instanceof Error ? error.message : String(error),
    });
    return { text: null, timedOut };
  }
}

/** 去掉模型偶发的元前缀（"可以这样回应："）与整体包裹的引号，让发言像真人直说 */
function cleanupSpeech(text: string): string {
  return text
    .replace(/^(可以这样回应|可以这样答|回应|发言|回复|答道|说)[：:]\s*/u, '')
    .replace(/^[「『“"']+/, '')
    .replace(/[」』”"']+$/, '')
    .trim();
}

function buildSystemPrompt(request: GameSpeechRequest): string {
  const genderLine = request.gender === 'male'
    ? `你的性别：男性。说话风格：阳刚、果断、有担当。`
    : request.gender === 'female'
      ? `你的性别：女性。说话风格：细腻、敏锐、有韧性。`
      : '';

  const fewShotExamples = buildFewShotExamples(request);

  const repetitionGuard = request.ownPreviousSpeeches && request.ownPreviousSpeeches.length > 0
    ? [
        ``,
        `【防重复约束】你之前的发言：`,
        ...request.ownPreviousSpeeches.slice(-3).map((s) => `- "${s}"`),
        `- 不要重复以上任何观点或表达方式，请从全新角度回应`,
      ]
    : [];

  return [
    `你是一名专业的桌面推理游戏玩家，正在沉浸式扮演一个角色。`,
    `你的昵称：${request.nickname}`,
    `你的身份：${request.gameRole}`,
    `你的性格：${request.personality}`,
    genderLine,
    `当前阶段：${request.phase}，第 ${request.round} 轮`,
    request.customHint ? `角色任务：${request.customHint}` : '',
    ``,
    `## 核心规则`,
    `1. 只用简体中文，第一人称，像真人一样自然口语化`,
    `2. 严格扮演角色：说话方式、态度、措辞必须符合你的身份和性格`,
    `3. 结合上下文：回应对话中具体的人、事、线索，不要泛泛而谈`,
    `4. 禁止编造：绝不能虚构任何玩家没说过的话、没发生的事件`,
    `5. 禁止代言：不要说"XX认为""XX怀疑"除非对方亲口说过`,
    `6. 立场一致：不要前后矛盾，不要暴露你不该知道的信息`,
    `7. 简洁有力：1-3句话，不要长篇大论`,
    `8. 禁止重复：不要重复别人说过的观点，也不要重复自己之前的发言`,
    ...repetitionGuard,
    ``,
    `## 示例参考（帮助你理解什么样的发言是好的）`,
    fewShotExamples,
    ``,
    `## 输出要求`,
    `直接输出发言内容，不加任何前缀、引号或元注释。只输出你要说的话。`,
  ].filter(Boolean).join('\n');
}

function buildFewShotExamples(request: GameSpeechRequest): string {
  const personality = request.personality;

  if (/豪爽|直率|暴躁|果断|强势|威严/.test(personality)) {
    return [
      `### 豪爽直率型角色示例`,
      `- 开场："我这人不会绕弯子，先把我看到的说清楚。"`,
      `- 质疑："等一下，你这个说法我怎么听着不对劲？案发时你到底在哪？"`,
      `- 反驳："纯属胡说！我有什么动机？倒是那位，欠了一屁股债吧？"`,
    ].join('\n');
  }

  if (/谨慎|冷静|细心|敏锐|理性|观察|沉稳|专业/.test(personality)) {
    return [
      `### 谨慎理性型角色示例`,
      `- 开场："我先按线索慢慢说，大家帮忙补充。"`,
      `- 质疑："这个细节很关键——你说你当时在厨房，但为什么你的鞋上有泥土？"`,
      `- 反驳："我理解你的怀疑，但从逻辑上讲，如果我是凶手，我为什么要留下这么明显的证据？"`,
    ].join('\n');
  }

  if (/敏感|温柔|胆小|内向|善良|忧郁/.test(personality)) {
    return [
      `### 温柔敏感型角色示例`,
      `- 开场："我、我先把看到的细节说清楚……希望大家不要误会我。"`,
      `- 质疑："那个……我有点害怕，但我还是想说，他那天晚上好像一直在看表……"`,
      `- 反驳："我没有要害他……我怎么会……你们真的觉得是我吗？"`,
    ].join('\n');
  }

  if (/精明|圆滑|狡诈|贪婪|狡猾/.test(personality)) {
    return [
      `### 精明圆滑型角色示例`,
      `- 开场："各位先别急，这事儿恐怕没那么简单。"`,
      `- 质疑："有意思……你说你什么都没看见，那你手里的血迹怎么解释？"`,
      `- 反驳："我承认我和他有生意往来，但这恰恰说明我没有动机——死人还不了钱，对吧？"`,
    ].join('\n');
  }

  return [
    `### 通用示例`,
    `- 开场："我先说一下我的情况，案发时我在……"`,
    `- 质疑："你说你在厨房，但有人看到你从书房方向出来，怎么解释？"`,
    `- 反驳："我和他确实有过节，但那天我根本没有机会接近他。"`,
  ].join('\n');
}

function buildUserPrompt(request: GameSpeechRequest): string {
  const recent = request.recentEvents.slice(-5);
  const phase = request.phase;

  if (recent.length === 0) {
    return `游戏刚开始，请做一段符合你身份的开场发言。要简短、有个性、能让人记住你是谁。`;
  }

  const phaseGuidance: Record<string, string> = {
    '自我介绍': '现在是自我介绍阶段。请介绍自己的身份、与受害者的关系、案发时你在做什么。要自然，像是在回答朋友的询问。',
    '圆桌讨论': '现在是圆桌讨论阶段。请根据最近的对话内容做出回应——可以质疑某人、为自己辩护、提出新怀疑、或引导话题。要说具体的话，不要泛泛而谈。',
    '公开指控': '现在是公开指控阶段。请给出你最终怀疑的对象和理由。要有理有据，态度坚定但不要人身攻击。',
    '最终指认': '现在是最终投票前的最后发言机会。请表明你的选择和理由。',
  };

  const guidance = phaseGuidance[phase] ?? '请根据最近的对话内容做出自然回应。';

  return `${guidance}

最近的对话记录：
${recent.map((r) => `• ${r}`).join('\n')}

请输出你的回应（1-3句话，口语化，符合你的性格和身份）：`;
}

/**
 * 生成带性格差异的备用模板（LLM 不可用时使用）。
 * 每个性格有独特风格，减少重复感。
 */
export function pickVariedTemplate(
  templates: string[],
  recentEvents: string[],
  seed: number,
): string {
  // 用最近事件做简单变化，让同一个模板在不同上下文产生不同效果
  const contextHash = recentEvents.join('').length;
  const index = (seed + contextHash) % templates.length;
  return templates[index];
}


