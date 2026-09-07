# 部署指南

裸机部署（PM2 + nginx，无 Docker）。

## 架构

```
            ┌─────────────────────────────────────────┐
  浏览器 ──► │  nginx :80                              │
            │   ├── /api/*  ─────────► API :4000      │
            │   ├── /health ─────────► API :4000      │
            │   └── /      ─────────► 静态 SPA        │
            └─────────────────────────────────────────┘
                           │
                           ▼
            ┌─────────────────────────────────────────┐
            │  PM2 进程                                │
            │   ├── tianma-api     (Fastify :4000)    │
            │   └── tianma-worker  (BullMQ consumer)  │
            └─────────────────────────────────────────┘
                           │
                           ▼
            ┌─────────────────────────────────────────┐
            │  基础设施                                 │
            │   ├── MySQL 8   (tianma_chat)           │
            │   └── Redis 7   (BullMQ + Pub/Sub)      │
            └─────────────────────────────────────────┘
```

## 前置条件

| 组件 | 版本 | 用途 |
|------|------|------|
| Node.js | >= 20.11 | 运行时（tsx 直接跑 .ts，无构建步骤） |
| pnpm | >= 9.0 | 包管理 |
| MySQL | 8.0+ | 主数据库 |
| Redis | 7+ | 队列 + 房间事件 Pub/Sub |
| PM2 | latest | 进程守护 |
| nginx | latest | 反代 + 静态托管 |

## 首次部署

```bash
# 1. 克隆仓库
git clone <repo-url> /opt/tianma
cd /opt/tianma

# 2. 配置环境变量（生产机密，不要提交 .env）
cp .env.example .env
# 编辑 .env：
#   - DATABASE_URL 指向生产 MySQL（建议专用最小权限账号，不要用 root）
#   - REDIS_URL 指向生产 Redis
#   - JWT_SECRET 用高强度随机值：node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
#   - MODELS_CONFIG 配真实模型端点
#   - NODE_ENV=production

# 3. 一键发布（安装 + migrate + 构建 + 归档）
RELOAD_PM2=1 bash scripts/release.sh

# 4. 配置 nginx
sudo cp deploy/nginx-tianma.conf /etc/nginx/sites-available/tianma
# 编辑 server_name 为实际域名
sudo ln -s /etc/nginx/sites-available/tianma /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 5. 验证
curl http://localhost/health
# 期望：{"ok":true,"queue":"bullmq",...}
```

## 日常更新

```bash
git pull
RELOAD_PM2=1 bash scripts/release.sh
```

`release.sh` 会：
1. `pnpm install --frozen-lockfile`（可复现）
2. `prisma migrate deploy`（幂等）
3. `vite build`（前端）
4. 打包到 `releases/<时间戳>/`（可回滚）
5. `pm2 reload ecosystem.config.cjs`（零停机）

## 回滚

```bash
ln -sfn releases/<旧时间戳> releases/current
cd releases/current && pm2 reload ecosystem.config.cjs
```

## PM2 关键配置

| 参数 | 值 | 原因 |
|------|-----|------|
| `kill_timeout` (worker) | 600000ms (10min) | BullMQ close() 会等在途 job 跑完，必须大于单次讨论最大耗时 |
| `exec_mode` | fork | BullMQ 不支持 cluster 共享连接 |
| `instances` | 1 | 多实例会导致 lease 竞争与重复消费 |
| `max_memory_restart` | api=512M, worker=1G | 防止内存泄漏拖垮机器 |

## 监控

```bash
pm2 status              # 进程状态
pm2 logs tianma-api     # 实时日志
pm2 monit               # 资源监控
pm2 save                # 保存进程列表，开机自启
pm2 startup             # 生成开机自启脚本
```

## 故障排查

| 现象 | 检查 |
|------|------|
| 任务不执行 | `pm2 logs tianma-worker` 看是否连上 Redis；确认 `QUEUE_DRIVER=bullmq` |
| 502 Bad Gateway | `pm2 status` 看 API 是否存活；`curl localhost:4000/health` |
| WS 断开 | nginx 是否配了 `Upgrade`/`Connection` 头；`proxy_read_timeout` 是否够大 |
| migrate 失败 | 确认 MySQL 可连；`pnpm db:status` 看迁移状态 |
| 前端白屏 | `apps/web/dist/index.html` 是否存在；nginx `root` 路径是否正确 |

## 安全清单

- [ ] JWT_SECRET 已替换为高强度随机值
- [ ] MySQL 不用 root，创建专用最小权限账号
- [ ] Redis 设置 requirepass（生产不要裸奔）
- [ ] nginx 加 SSL（Let's Encrypt）
- [ ] `client_max_body_size` 已限制
- [ ] `.env` 文件权限 `chmod 600`
- [ ] 日志目录 `logs/` 不对外开放
