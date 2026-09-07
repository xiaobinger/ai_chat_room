/**
 * 模型调用层。
 *
 * 与修复前的三处关键差别：
 * 1. 失败一律抛出，绝不返回"（模型调用失败）"这种伪装成内容的字符串 —— 否则导演会把
 *    错误文本当作真实发言喂给下一个角色，治理与复盘全部失真。
 * 2. 每次调用带 AbortSignal.timeout，兑现 settings.aiTimeoutSeconds。
 * 3. 返回 token 消耗，预算才有的可结算；端点不给 usage 时按 chars/4 估算并标注来源。
 */
import { SummaryDraftSchema, type SummaryDraft } from '@tianma/contracts';

export interface ContextTurn {
  speaker: string;
  content: string;
}

export interface SpeakRequest {
  roleName: string;
  systemPrompt: string;
  topic: string;
  goal?: string;
  stance?: string;
  context: ContextTurn[];
  maxTokens: number;
  timeoutMs: number;
}

export interface SpeakResult {
  text: string;
  tokens: number;
  /** false 表示端点没返回 usage，tokens 是 chars/4 估算值，必须记进审计 */
  tokensMeasured: boolean;
}

export class ModelCallError extends Error {
  constructor(
    readonly kind: 'timeout' | 'http' | 'transport' | 'empty' | 'malformed',
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ModelCallError';
  }
}

export interface RelevanceRequest {
  topic: string;
  goal?: string;
  content: string;
  timeoutMs: number;
}

export const RELEVANCE_SYSTEM_PROMPT =
  '你是讨论质量评估器。给定主题与一条发言，只输出一个 0 到 1 之间的数字表示该发言与主题的相关度：' +
  '1 表示紧扣主题，0 表示完全跑题。不要输出任何其它字符。';

/**
 * 把模型的自由文本打分收成 0..1。
 * 解析不出来就返回 null —— 调用方据此弃权，绝不拿猜出来的值去做处罚决定。
 */
export function parseRelevanceScore(text: string): number | null {
  const match = /\d+(?:\.\d+)?/.exec(text);
  if (!match) return null;
  let value = Number.parseFloat(match[0]);
  if (!Number.isFinite(value)) return null;
  // 模型经常忽略指令改用百分制
  if (value > 1) value /= 100;
  return Math.max(0, Math.min(1, value));
}

export interface ModelProvider {
  readonly name: string;
  speak(request: SpeakRequest): Promise<SpeakResult>;
  /** 主题相关度 0..1；null 表示这一路信号不可用。 */
  scoreRelevance(request: RelevanceRequest): Promise<number | null>;
  /** 复盘草稿；null 表示模型不可用或输出不合契约，调用方退化为摘录。 */
  summarize(request: SummarizeRequest): Promise<SummaryDraft | null>;
}

/** 端点不返回 usage 时的粗估口径。 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isAbort(error)) throw new ModelCallError('timeout', `模型调用超过 ${timeoutMs}ms`);
    throw new ModelCallError('transport', `模型端点不可达：${(error as Error).message}`);
  }

  const raw = await response.text();
  if (!response.ok) {
    throw new ModelCallError(
      'http',
      `模型返回 HTTP ${response.status}：${raw.slice(0, 300)}`,
      response.status,
    );
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new ModelCallError('malformed', `模型响应不是合法 JSON：${raw.slice(0, 200)}`);
  }
}

function pickUsage(data: Record<string, unknown>, key: string): number | null {
  const usage = data.usage as Record<string, unknown> | undefined;
  const value = usage?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function buildSystemPrompt(request: SpeakRequest): string {
  return [
    request.systemPrompt,
    `本场讨论主题：${request.topic}`,
    request.goal ? `讨论目标：${request.goal}` : '',
    request.stance ? `你的立场：${request.stance}` : '',
    '直接输出发言内容本身，不要加角色名前缀，不要输出解释或标注。',
    `发言控制在 ${request.maxTokens} tokens 以内。`,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface SummarySourceTurn {
  sequence: number;
  speaker: string;
  content: string;
}

function relevanceUserPrompt(request: RelevanceRequest): string {
  return [
    `主题：${request.topic}`,
    request.goal ? `讨论目标：${request.goal}` : '',
    `待评发言：${request.content}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface SummarizeRequest {
  topic: string;
  goal: string;
  completionCriteria: string;
  turns: SummarySourceTurn[];
  timeoutMs: number;
}

export const SUMMARY_SYSTEM_PROMPT =
  '你是讨论复盘助手。根据给定的编号发言，输出一个 JSON 对象，字段为：' +
  'completionScore(0-100 整数)、keyPoints、disputes、consensus、unresolved、followUps、camps。' +
  '前五个字段每项形如 {"text":"结论","sourceSequences":[编号数组]}，' +
  'camps 形如 [{"name":"阵营名","speakers":["发言人姓名"],"position":"立场"}]。' +
  'sourceSequences 只能使用输入中出现过的编号，不得编造。只输出 JSON，不要额外解释。';

/**
 * 从模型自由文本里取出第一个平衡的 JSON 对象。
 * 端点普遍不支持 response_format，只能自己刮；刮不出来就返回 null 让上层降级。
 */
export function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function summarizeUserPrompt(request: SummarizeRequest): string {
  const lines = request.turns.map((turn) => `#${turn.sequence}【${turn.speaker}】${turn.content}`);
  return [
    `主题：${request.topic}`,
    request.goal ? `讨论目标：${request.goal}` : '',
    request.completionCriteria ? `完成条件：${request.completionCriteria}` : '',
    `共 ${request.turns.length} 条发言：`,
    ...lines,
  ]
    .filter(Boolean)
    .join('\n');
}

/** 相关度与复盘共用的"要一个 JSON 回来"的小调用。 */
async function requestJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown | null> {
  try {
    const data = await postJson(url, headers, body, timeoutMs);
    const choices = data.choices as Array<{ message?: { content?: unknown } }> | undefined;
    const text = choices?.[0]?.message?.content;
    return typeof text === 'string' ? extractJsonObject(text) : null;
  } catch {
    return null;
  }
}

/**
 * OpenAI 兼容端点。openai / deepseek / custom 三种 provider 的请求体完全同构，
 * 只有默认 baseURL 不同，因此不再各自复制一份实现。
 */
export class OpenAICompatibleProvider implements ModelProvider {
  constructor(
    readonly name: string,
    private readonly apiKey: string,
    private readonly baseURL: string,
    private readonly model: string,
  ) {}

  async speak(request: SpeakRequest): Promise<SpeakResult> {
    const data = await postJson(
      `${this.baseURL}/chat/completions`,
      { Authorization: `Bearer ${this.apiKey}` },
      {
        model: this.model,
        max_tokens: request.maxTokens,
        temperature: 0.7,
        messages: [
          { role: 'system', content: buildSystemPrompt(request) },
          ...request.context.map((turn) => ({
            role: 'user',
            content: `【${turn.speaker}】${turn.content}`,
          })),
        ],
      },
      request.timeoutMs,
    );

    const choices = data.choices as Array<{ message?: { content?: unknown } }> | undefined;
    const text = choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.trim() === '') {
      throw new ModelCallError('empty', `模型未产出内容：${JSON.stringify(data).slice(0, 200)}`);
    }

    const measured = pickUsage(data, 'completion_tokens');
    return {
      text: text.trim(),
      tokens: measured ?? estimateTokens(text),
      tokensMeasured: measured !== null,
    };
  }

  /** 打分失败一律返回 null 让检测器弃权，不能拿猜出来的值去处罚角色。 */
  async scoreRelevance(request: RelevanceRequest): Promise<number | null> {
    try {
      const data = await postJson(
        `${this.baseURL}/chat/completions`,
        { Authorization: `Bearer ${this.apiKey}` },
        {
          model: this.model,
          max_tokens: 8,
          temperature: 0,
          messages: [
            { role: 'system', content: RELEVANCE_SYSTEM_PROMPT },
            { role: 'user', content: relevanceUserPrompt(request) },
          ],
        },
        request.timeoutMs,
      );
      const choices = data.choices as Array<{ message?: { content?: unknown } }> | undefined;
      const text = choices?.[0]?.message?.content;
      return typeof text === 'string' ? parseRelevanceScore(text) : null;
    } catch {
      return null;
    }
  }

  async summarize(request: SummarizeRequest): Promise<SummaryDraft | null> {
    const json = await requestJson(
      `${this.baseURL}/chat/completions`,
      { Authorization: `Bearer ${this.apiKey}` },
      {
        model: this.model,
        // 复盘要引用多条编号，输出比打分长得多；给足空间否则 JSON 会被截断成无效
        max_tokens: 1600,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: summarizeUserPrompt(request) },
        ],
      },
      request.timeoutMs,
    );
    const parsed = SummaryDraftSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  }
}

export class AnthropicProvider implements ModelProvider {
  constructor(
    readonly name: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async speak(request: SpeakRequest): Promise<SpeakResult> {
    const data = await postJson(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.model,
        max_tokens: request.maxTokens,
        system: buildSystemPrompt(request),
        messages: request.context.map((turn) => ({
          role: 'user',
          content: `【${turn.speaker}】${turn.content}`,
        })),
      },
      request.timeoutMs,
    );

    const blocks = data.content as Array<{ text?: unknown }> | undefined;
    const text = blocks?.find((block) => typeof block.text === 'string')?.text;
    if (typeof text !== 'string' || text.trim() === '') {
      throw new ModelCallError('empty', `模型未产出内容：${JSON.stringify(data).slice(0, 200)}`);
    }

    const measured = pickUsage(data, 'output_tokens');
    return {
      text: text.trim(),
      tokens: measured ?? estimateTokens(text),
      tokensMeasured: measured !== null,
    };
  }

  async scoreRelevance(request: RelevanceRequest): Promise<number | null> {
    try {
      const data = await postJson(
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
        {
          model: this.model,
          max_tokens: 8,
          temperature: 0,
          system: RELEVANCE_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: relevanceUserPrompt(request) }],
        },
        request.timeoutMs,
      );
      const blocks = data.content as Array<{ text?: unknown }> | undefined;
      const text = blocks?.find((block) => typeof block.text === 'string')?.text;
      return typeof text === 'string' ? parseRelevanceScore(text) : null;
    } catch {
      return null;
    }
  }

  async summarize(request: SummarizeRequest): Promise<SummaryDraft | null> {
    try {
      const data = await postJson(
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
        {
          model: this.model,
          max_tokens: 1600,
          temperature: 0.2,
          system: SUMMARY_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: summarizeUserPrompt(request) }],
        },
        request.timeoutMs,
      );
      const blocks = data.content as Array<{ text?: unknown }> | undefined;
      const text = blocks?.find((block) => typeof block.text === 'string')?.text;
      if (typeof text !== 'string') return null;
      const parsed = SummaryDraftSchema.safeParse(extractJsonObject(text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}

/**
 * 离线可复现的 mock provider。
 *
 * 它刻意带两种可预测的"病症"，让验收 #2（治理事件）在完全没有外部模型时仍能复现：
 * 每 4 轮原样复述上一条发言（喂给 R-04 重复检测器），每 6 轮提一次禁区话题
 * （喂给 R-05 关键词检测器）。两条都是确定性触发，不依赖模型质量。
 *
 * 相关度打分恒返回 null：mock 没有判断语义的能力，装出一个分数只会让 off_topic
 * 规则基于噪声处罚角色。离线场景下治理事件由上面两条确定性病症产生。
 */
export class MockModelProvider implements ModelProvider {
  constructor(readonly name = 'mock') {}

  async speak(request: SpeakRequest): Promise<SpeakResult> {
    const turn = request.context.length + 1;
    const last = request.context[request.context.length - 1];
    // 按角色名错开触发点，否则所有角色会在同一轮同时犯病，不像真实的跑偏
    const phase = turn + (request.roleName.length % 3);

    let text: string;
    if (phase % 6 === 0) {
      text = '顺便说一句，最近听说有人在聊内幕交易的机会，这个是不是比议题本身更有意思？';
    } else if (phase % 4 === 0 && last) {
      text = last.content;
    } else {
      text = `围绕「${request.topic}」的第 ${turn} 轮观点：应当先明确衡量标准，再比较方案优劣。（立场：${request.stance || '未设定'}）`;
    }
    return { text, tokens: estimateTokens(text), tokensMeasured: false };
  }

  /** mock 没有判断语义的能力，装出一个分数只会让 off_topic 基于噪声处罚角色。 */
  async scoreRelevance(): Promise<number | null> {
    return null;
  }

  /** 同理不假装会归纳：返回 null 让上层降级为"摘录"，摘录依然带真实引用，可追溯性不受影响。 */
  async summarize(): Promise<SummaryDraft | null> {
    return null;
  }
}
