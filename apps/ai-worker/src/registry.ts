import { z } from 'zod';
import {
  AnthropicProvider,
  MockModelProvider,
  OpenAICompatibleProvider,
  type ModelProvider,
} from './model-provider';

export const ModelConfigSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(['mock', 'openai', 'anthropic', 'deepseek', 'custom']),
  apiKey: z.string().default(''),
  baseURL: z.string().optional(),
  model: z.string().optional(),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
/** 构造入参用 z.input：apiKey 有默认值，不该强迫调用方重复书写。 */
export type ModelConfigInput = z.input<typeof ModelConfigSchema>;

/** auto / default 这两个占位名不允许同时作为真实模型名存在，否则无法解析。 */
const ALIAS_NAMES = new Set(['auto', 'default']);

const DEFAULT_BASE_URLS: Partial<Record<ModelConfig['provider'], string>> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
};

export class UnknownModelError extends Error {
  constructor(readonly requested: string, message: string) {
    super(message);
    this.name = 'UnknownModelError';
  }
}

function buildProvider(input: ModelConfigInput): ModelProvider {
  const config = ModelConfigSchema.parse(input);
  if (ALIAS_NAMES.has(config.name.toLowerCase())) {
    throw new Error(`模型名 "${config.name}" 是保留别名，请改用别的名字`);
  }
  switch (config.provider) {
    case 'mock':
      return new MockModelProvider(config.name);
    case 'anthropic':
      if (!config.apiKey) throw new Error(`模型 ${config.name} 缺少 apiKey`);
      return new AnthropicProvider(config.name, config.apiKey, config.model ?? 'claude-3-haiku-20240307');
    case 'custom':
      if (!config.baseURL || !config.model) {
        throw new Error(`provider=custom 的模型 ${config.name} 必须同时给出 baseURL 与 model`);
      }
      return new OpenAICompatibleProvider(config.name, config.apiKey, config.baseURL, config.model);
    default: {
      const baseURL = config.baseURL ?? DEFAULT_BASE_URLS[config.provider];
      if (!baseURL) throw new Error(`模型 ${config.name} 缺少 baseURL`);
      const model = config.model ?? (config.provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini');
      return new OpenAICompatibleProvider(config.name, config.apiKey, baseURL, model);
    }
  }
}

/** RunRunner 只依赖解析能力，便于用假 provider 单测调度循环。 */
export interface ModelResolver {
  resolve(requested: string | null | undefined): ModelProvider;
}

export class ModelRegistry implements ModelResolver {
  private readonly models = new Map<string, ModelProvider>();

  constructor(
    configs: ModelConfigInput[],
    private readonly defaultModel: string | null,
  ) {
    for (const config of configs) this.models.set(config.name, buildProvider(config));
    if (!this.models.has('mock')) this.models.set('mock', new MockModelProvider('mock'));
  }

  has(name: string): boolean {
    return this.models.has(name);
  }

  get names(): string[] {
    return [...this.models.keys()];
  }

  /**
   * 解析失败一定抛错。修复前这里是 `console.warn + 回落 mock`：
   * RoomRole.modelName 缺省就是 'auto'，于是所有角色都在跑 mock，
   * 而界面上写着的是真模型名 —— 这正是本项目最难发现的一类故障。
   * 抛错由 run-runner 按角色兜住，转成 state error，而不是让整个进程崩掉。
   */
  resolve(requested: string | null | undefined): ModelProvider {
    const key = requested?.trim();
    if (!key || ALIAS_NAMES.has(key.toLowerCase())) {
      if (this.defaultModel && this.models.has(this.defaultModel)) {
        return this.models.get(this.defaultModel)!;
      }
      throw new UnknownModelError(
        key ?? 'auto',
        `没有配置 DEFAULT_MODEL，无法解析 "${key ?? 'auto'}"。已注册：${this.names.join(', ')}。` +
          `要显式使用离线模型，请把角色的 modelName 设为 mock。`,
      );
    }
    const provider = this.models.get(key);
    if (!provider) {
      throw new UnknownModelError(
        key,
        `MODELS_CONFIG 里没有名为 "${key}" 的模型。已注册：${this.names.join(', ')}`,
      );
    }
    return provider;
  }
}

export function parseModelsConfig(raw: string | undefined): ModelConfig[] {
  if (!raw?.trim()) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    // 注意 dotenv 会在第一个换行处截断取值：多行 MODELS_CONFIG 会以 "[ 这种残片进来
    throw new Error(`MODELS_CONFIG 不是合法 JSON（必须是单行）：${(error as Error).message}`);
  }
  const parsed = z.array(ModelConfigSchema).safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`MODELS_CONFIG 不符合契约：${detail}`);
  }
  return parsed.data;
}

export function createModelRegistry(env: NodeJS.ProcessEnv = process.env): ModelRegistry {
  return new ModelRegistry(parseModelsConfig(env.MODELS_CONFIG), env.DEFAULT_MODEL?.trim() || null);
}
