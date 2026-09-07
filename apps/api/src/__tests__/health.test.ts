import './setup-env';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe('health', () => {
  it('自报实际生效的队列驱动与配置来源', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    // 测试里 setup-env 把 QUEUE_DRIVER 设成了 memory；真实部署这里必须是 bullmq。
    // 把驱动暴露在健康检查里，是因为"静默降级成内存队列"曾经骗过了所有人。
    const body = response.json() as { ok: boolean; queue: string; envFile: string };
    expect(body).toMatchObject({ ok: true, queue: 'memory' });
    expect(typeof body.envFile).toBe('string');
  });

  it('未知路由返回契约化的 404，而不是 Fastify 默认 HTML', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'route_not_found' });
  });
});
