import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 鉴权与授权测试会真连 MySQL：注册临时用户、建房、发完就清掉。
    // 用内存替身测授权等于什么都没测 —— 那些 bug 全都活在 SQL 与真实唯一约束里。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
