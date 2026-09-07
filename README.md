<div align="center">

# 🐴 天马行空 · Tianma Chat Room

**多角色 AI 自主辩论平台 — 让 AI 们围坐一堂，唇枪舌剑**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥20.11-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.4-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)](https://www.fastify.io/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![BullMQ](https://img.shields.io/badge/BullMQ-Redis-E74C3C?logo=redis&logoColor=white)](https://docs.bullmq.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[English](#english) · [快速开始](#-快速开始) · [核心特性](#-核心特性) [架构概览](#-架构概览) · [验收自查](#-验收自查)

---

</div>

> 多个 AI 角色围绕议题自主辩论，服务端统一调度，AI 管理员按规则治理，结束后生成可追溯到原消息的复盘。

## ✨ 快速开始

**前置要求：** Node ≥ 20.11 · pnpm 9 · MySQL 8 · Redis（模型端点可以是任意 OpenAI 兼容服务）

```bash
# 克隆项目
git clone git@github.com:xiaobinger/ai_chat_room.git
cd ai_chat_room

# 一键初始化
pnpm install
cp .env.example .env      # 必填 DATABASE_URL / REDIS_URL / JWT_SECRET / MODELS_CONFIG
pnpm setup                # 生成 Prisma 客户端 → 迁移建表 → 灌演示数据
pnpm verify:queue         # 证明队列与事件桥跨进程真的通
```

`pnpm setup` 结束后会打印演示账号：`owner@tianma.dev / tianma-demo`

### 🚀 启动三个进程

```bash
pnpm dev:api      # HTTP + WebSocket，默认 :4000
pnpm dev:worker   # 讨论导演与模型调用
pnpm dev:web      # 界面，默认 :3000（开发期经 Vite proxy 反代 /api 与 /ws）
```

> ⚠️ 三者都要跑。API 与 Worker 靠 Redis 上的 BullMQ 队列和 Pub/Sub 交接 —— 只起 API 时讨论不会推进。

---

## 🎯 核心特性

| 特性 | 说明 |
|------|------|
| 🎭 **多角色辩论** | 多个 AI 角色各持立场，围绕议题自主发言交锋 |
| 🎬 **导演调度** | `DiscussionDirector` 纯逻辑模块统一决定发言顺序，角色间不能互相触发 |
| 🛡️ **AI 治理** | 管理员按规则检测违规，阶梯式处置：remind → warn → mute → kick |
| 📝 **可追溯复盘** | 讨论结束后生成复盘，每条引用都能定位到原始消息 |
| ⚡ **实时广播** | WebSocket 推送，讨论过程实时可见 |
| 🔒 **策略不可变** | 治理规则版本化管理，历史处置记录永久可查 |

---

## 🏗️ 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        天马行空 · 系统架构                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐     ┌──────────────┐     ┌───────────────┐       │
│  │  Web SPA │◄───►│  API Server  │◄───►│  AI Worker    │       │
│  │  (Vite)  │ WS  │  (Fastify 5) │     │  (BullMQ)     │       │
│  └──────────┘     └──────┬───────┘     └───────┬───────┘       │
│                          │                     │               │
│                          ▼                     ▼               │
│                   ┌──────────────┐     ┌───────────────┐       │
│                   │    MySQL 8   │     │     Redis     │       │
│                   │   (Prisma)   │     │  (BullMQ/Sub) │       │
│                   └──────────────┘     └───────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 模块分层

| 层级 | 模块 | 职责 |
|------|------|------|
| **应用层** | `apps/web` | Vite + React SPA，nginx 直出静态文件 |
| | `apps/api` | Fastify 5；鉴权、房间、Run 控制、治理、复盘、WS |
| | `apps/ai-worker` | 队列消费端：导演循环、模型调用、治理执行、复盘生成 |
| **包层** | `packages/contracts` | Zod 契约定义 |
| | `packages/database` | Prisma Schema + 发号器 |
| | `packages/ai-core` | 状态机 / 预算 / 导演 / 治理，纯函数可单测 |
| | `packages/queue` | BullMQ 队列 + Redis Pub/Sub 事件桥 |

### 设计原则

> **`DiscussionDirector`**（在 `packages/ai-core`，纯逻辑无 IO）是唯一能决定"下一位谁发言"的模块，AI 角色不能互相触发。Worker 认领 Run 后进入循环：重读状态 → 查预算 → 选人 → 治理检测 → 调模型 → 落库 → 广播。数据库是唯一真相，Pub/Sub 只负责"让正在发生的事实时可见"。

---

## ✅ 验收自查

```bash
pnpm verify      # typecheck + lint + 全量单测
pnpm verify:run  # 用真实 MySQL/Redis/模型端点跑完一场讨论
pnpm verify:e2e  # 逐条验 mvp-spec §9 的 7 条验收条件（需上面三个进程在跑）
```

`verify:e2e` 输出验收清单，每条一行 PASS/FAIL：

```
PASS  #1 多个角色围绕主题自主发言 — 9 条 AI 发言 / 3 个角色 / 3 轮
PASS  #2 阶梯随重复违规逐级升档 — 时间序 remind → warn → mute → kick
PASS  #5 撤销写入撤销人与时间，且原处置动作未被改写
PASS  #7 复盘的每条引用都能定位到真实消息 — 引用 9 处，指向不明的 0 处
...
```

📋 细节与当前覆盖状态见 [docs/verification.md](docs/verification.md)

---

## ⚠️ 约定与坑

| 规则 | 说明 |
|------|------|
| **`MODELS_CONFIG` 必须写成单行 JSON** | dotenv 会在第一个换行处截断取值，多行写法会被解析成 `"["`，于是所有角色静默跑 mock，而界面上显示的是真模型名 |
| **`QUEUE_DRIVER` 要显式声明** | 设成 `bullmq` 而缺 `REDIS_URL` 时进程直接启动失败，不再悄悄退回内存队列 |
| **Redis 密码必须带在连接串里** | 缺密码时 BullMQ 不报错，只是无限重连把任务静默卡住 |
| **Node 侧不产出 `dist`** | 包与 app 都用 tsx 直跑源码。曾因陈旧 `dist/*.d.ts` 与已丢失的源码分叉而整体崩坏 |
| **策略不可变** | 改治理规则是发布新 `version`，旧版本永不修改也不删除，治理事件按 `policyVersion` 引用它 |

📖 背景见 [docs/decisions/004-rebuild-deviations.md](docs/decisions/004-rebuild-deviations.md)，日常开发流程见 [docs/development.md](docs/development.md)

---

## English

**Tianma Chat Room** — A multi-role AI debate platform where AI characters autonomously discuss topics under unified server scheduling, with AI moderation and traceable post-discussion reviews.

```bash
git clone git@github.com:xiaobinger/ai_chat_room.git
cd ai_chat_room
pnpm install && cp .env.example .env && pnpm setup
pnpm dev:api & pnpm dev:worker & pnpm dev:web
```

---

<div align="center">

**[文档](docs/development.md)** · **[验证报告](docs/verification.md)** · **[项目历史](docs/project-history.md)**

Made with ❤️ by [xiaobinger](https://github.com/xiaobinger)

</div>
