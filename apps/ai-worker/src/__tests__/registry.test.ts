import { describe, expect, it } from 'vitest';
import { MockModelProvider } from '../model-provider';
import {
  createModelRegistry,
  ModelRegistry,
  parseModelsConfig,
  UnknownModelError,
} from '../registry';

describe('parseModelsConfig', () => {
  it('treats a missing config as "no models", not as a silent mock', () => {
    expect(parseModelsConfig(undefined)).toEqual([]);
    expect(parseModelsConfig('   ')).toEqual([]);
  });

  it('rejects the truncated value dotenv produces from a multi-line .env entry', () => {
    // 这是本项目真实踩过的坑：MODELS_CONFIG='[ { ... } ]' 换行写法会被 dotenv 截成 "["
    expect(() => parseModelsConfig('[')).toThrow(/必须是单行/);
  });

  it('reports which field broke the contract', () => {
    expect(() => parseModelsConfig('[{"name":"a","provider":"openai"}]')).not.toThrow();
    let message = '';
    try {
      parseModelsConfig('[{"name":"a","provider":"mistral"}]');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/MODELS_CONFIG 不符合契约/);
    expect(message).toContain('0.provider');
  });

  it('requires baseURL and model for provider=custom', () => {
    expect(() =>
      createModelRegistry({ MODELS_CONFIG: '[{"name":"x","provider":"custom","apiKey":"k"}]' }),
    ).toThrow(/baseURL 与 model/);
  });
});

describe('ModelRegistry.resolve', () => {
  const registry = () =>
    new ModelRegistry([{ name: 'gpt', provider: 'openai', apiKey: 'k', model: 'gpt-4o-mini' }], 'gpt');

  it('always registers mock so离线测试仍可用', () => {
    expect(registry().resolve('mock')).toBeInstanceOf(MockModelProvider);
  });

  it('resolves auto to DEFAULT_MODEL', () => {
    for (const requested of ['auto', 'default', '', null, undefined]) {
      expect(registry().resolve(requested).name).toBe('gpt');
    }
  });

  it('refuses to fall back to mock when no DEFAULT_MODEL is configured', () => {
    const bare = new ModelRegistry([], null);
    expect(() => bare.resolve('auto')).toThrow(UnknownModelError);
    expect(() => bare.resolve('auto')).toThrow(/没有配置 DEFAULT_MODEL/);
    // 显式点名 mock 仍然是允许的 —— 拒绝的是"偷偷"回落
    expect(bare.resolve('mock')).toBeInstanceOf(MockModelProvider);
  });

  it('refuses an unknown model name instead of silently answering with mock', () => {
    // 修复前这里是 console.warn + 回落 mock：界面显示真模型，实际跑的是假数据
    expect(() => registry().resolve('typo')).toThrow(/MODELS_CONFIG 里没有名为 "typo"/);
    expect(() => registry().resolve('typo')).toThrow(UnknownModelError);
  });

  it('rejects a model named after a reserved alias', () => {
    expect(() => parseModelsConfig('[{"name":"auto","provider":"mock"}]')).not.toThrow();
    expect(() => new ModelRegistry([{ name: 'auto', provider: 'mock' }], null)).toThrow(/保留别名/);
  });

  it('lists what is actually available', () => {
    expect(registry().names).toEqual(['gpt', 'mock']);
  });
});

describe('createModelRegistry', () => {
  it('reads DEFAULT_MODEL and MODELS_CONFIG from the environment', () => {
    const built = createModelRegistry({
      MODELS_CONFIG: '[{"name":"本地","provider":"custom","apiKey":"k","baseURL":"http://x/v1","model":"auto"}]',
      DEFAULT_MODEL: '本地',
    });
    expect(built.resolve('auto').name).toBe('本地');
  });

  it('lets a misconfigured environment fail at startup, not mid-discussion', () => {
    expect(() => createModelRegistry({ MODELS_CONFIG: '{oops' })).toThrow(/MODELS_CONFIG/);
  });
});
