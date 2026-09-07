import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // 让浏览器直接吃契约源码，省掉"改了 src 忘了 build"这一步
      '@tianma/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
    },
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      // WS 端点就在 /api/v1/rooms/:roomId/ws 下，所以同一条代理规则同时覆盖 HTTP 与 WS，
      // 开发期不必处理 CORS，生产期 nginx 也照同一个前缀反代
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        ws: true,
      },
      // 健康检查在应用根而不是 /api 下；不单独代理就会命中 SPA 的 index.html 兜底
      '/health': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
