import type { ModelProvider } from '../model-provider';

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
  /** 当前阶段 */
  phase: string;
  /** 轮次 */
  round: number;
  /** 最近对话/事件（上下文感知用） */
  recentEvents: string[];
  /** 超时 */
  timeoutMs: number;
  /** 自定义提示（剧本杀任务等） */
  customHint?: string;
}

function logGameLlm(stage: 'request' | 'success' | 'fallback', payload: Record<string, unknown>): void {
  const line = JSON.stringify(payload);
  console.warn(`[game-llm] ${stage} ${line}`);
}

/**
 * 用 LLM 生成游戏发言——替代固定模板，让 AI 像真人一样说话。
 * LLM 不可用时返回 null，调用方回退到模板。
 */
export async function generateLlmSpeech(
  provider: ModelProvider,
  request: GameSpeechRequest,
): Promise<string | null> {
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
      maxTokens: 200,
      timeoutMs: request.timeoutMs,
    });
    const text = result.text.trim();
    if (!text || text.length < 2) {
      logGameLlm('fallback', { ...meta, reason: 'empty_response' });
      return null;
    }
    logGameLlm('success', { ...meta, length: text.length, tokens: result.tokens, tokensMeasured: result.tokensMeasured });
    return text;
  } catch (error) {
    logGameLlm('fallback', {
      ...meta,
      reason: 'provider_error',
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function buildSystemPrompt(request: GameSpeechRequest): string {
  return [
    `你正在玩一场桌面推理游戏，扮演一名角色。`,
    `你的昵称：${request.nickname}`,
    `你的身份：${request.gameRole}`,
    `你的性格：${request.personality}`,
    `当前阶段：${request.phase}，第 ${request.round} 轮`,
    request.customHint ? `额外提示：${request.customHint}` : '',
    ``,
    `要求：`,
    `- 用第一人称说话，像真人玩家一样自然`,
    `- 结合最近的对话内容做出回应，不要自顾自地说`,
    `- 发言长度 1-3 句话，不要太长`,
    `- 不要重复别人已经说过的内容`,
    `- 直接输出发言内容，不要加角色名前缀`,
  ].filter(Boolean).join('\n');
}

function buildUserPrompt(request: GameSpeechRequest): string {
  const recent = request.recentEvents.slice(-5);
  if (recent.length === 0) {
    return `游戏刚开始，请做一个开场发言。`;
  }
  return `最近的对话：\n${recent.map((r) => `- ${r}`).join('\n')}\n\n请根据以上内容做出回应。`;
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
