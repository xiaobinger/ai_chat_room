/**
 * PM2 进程配置 —— 裸机部署（无 Docker）
 *
 * 用法：
 *   pnpm start:api      -> 手工起 API（调试用）
 *   pnpm start:worker   -> 手工起 Worker（调试用）
 *   pm2 start ecosystem.config.cjs  -> 生产部署
 *   pm2 reload ecosystem.config.cjs -> 零停机重载
 *
 * 关键约束（见 apps/ai-worker/src/index.ts）：
 *   - Worker 的 BullMQ close() 会等在途 job 跑完，所以 PM2 kill_timeout 必须大于
 *     单次讨论的最大耗时（aiTimeoutSeconds），否则会被 SIGKILL 打断导致 job 丢失。
 *   - API 与 Worker 必须共用同一个 REDIS_URL，否则跨进程任务会静默丢失。
 *
 * 环境变量优先级：shell 环境 > ecosystem env > .env 文件。
 * 生产部署推荐把机密放在 shell 环境或 PM2 secret，不要提交 .env。
 */
module.exports = {
  apps: [
    {
      name: 'tianma-api',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'apps/api/src/main.ts',
      cwd: '.',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        QUEUE_DRIVER: 'bullmq',
      },
      error_file: 'logs/api-error.log',
      out_file: 'logs/api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'tianma-worker',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'apps/ai-worker/src/index.ts',
      cwd: '.',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      // 必须大于单次讨论最大耗时；默认 600s，可按需调大
      kill_timeout: 600000,
      env: {
        NODE_ENV: 'production',
        QUEUE_DRIVER: 'bullmq',
      },
      error_file: 'logs/worker-error.log',
      out_file: 'logs/worker-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
