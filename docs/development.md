# 开发指南

面向要改这个仓库的人。产品规格在 `docs/product/`，历史与决策在 `docs/project-history.md` 和 `docs/decisions/`。

## 仓库结构

```
apps/
  web/         Vite + React 18 SPA；react-router v6；开发期经 vite proxy 反代 /api 与 /ws
  api/         Fastify 5。HTTP + WebSocket，所有鉴权与授权边界在这一层
  ai-worker/   队列消费端：导演循环、模型调用、治理执行、复盘生成
packages/
  contracts/   zod 契约。所有共享类型与输入 schema 的唯一来源
  database/    Prisma schema + 迁移 + 客户端单例 + 消息发号 + .env 加载
  ai-core/     状态机、预算、导演选人、治理检测与处罚阶梯。纯函数，零 IO
  queue/       BullMQ 封装 + Redis Pub/Sub 桥 + 连接串解析
scripts/       verify-queue / verify-run / verify-e2e / 运维入口
prototype/     已批准的原型，UI 的唯一视觉依据（不参与 pnpm workspace）
```

`prototype/` 不在 workspace 里，改产品界面时它是参照物而不是要编辑的目标。

## 日常命令

| 目的 | 命令 |
|---|---|
| 装依赖 + 建表 + 灌种子 | `pnpm setup` |
| 三个进程跑起来 | `pnpm dev:api` / `pnpm dev:worker` / `pnpm dev:web`（三个终端） |
| 类型检查 | `pnpm typecheck`（含根 `scripts/`） |
| 全量单测 | `pnpm test` |
| 一把梭自查 | `pnpm verify` |
| 改 schema 后生成迁移并应用 | `pnpm db:migrate:dev --name <名字> --skip-seed` |
| 只重新生成客户端 | `pnpm db:generate` |
| 应用已有迁移（部署用） | `pnpm db:migrate` |
| 重新灌演示数据 | `pnpm db:seed` |

`pnpm -r` 按依赖拓扑序执行，且全部带 `--no-bail`：**遇到失败继续跑完再汇总**。这一点是刻意加的 —— 原先遇首个错误即中止，`packages/database` 一挂后面的包根本没跑，把错误全貌盖住了。

## 四条硬性约定

### 1. 不要在 Node 侧产出 `dist`

包和 app 的 `main`/`types` 都指向 `./src/*.ts`，`tsconfig` 一律 `noEmit`，运行时统一用 tsx。只有 `apps/web` 有构建产物（静态文件）。

理由不是省事：本项目崩坏的直接原因就是陈旧 `dist/*.d.ts` 与已丢失的源码分叉。别把 `dist` 重新变成真相来源。

### 2. 身份只从 JWT 来

任何 `*InputSchema` 里都不该出现 `ownerId` / `createdBy` / `senderId` / `approverId` 这类字段。路由用 `roomAccess(request, roomId, level)` 或 `authedUser(request)` 拿身份：

```ts
const access = await roomAccess(request, roomId, 'owner');   // 抛 401/403/404
```

`contracts` 是命名权威。加字段先加契约，别在插件里手搓 zod schema。

### 3. 消息序号只有一个发号点

`@tianma/database` 的 `createRoomMessage` / `appendRoomMessage`。API 和 Worker 都必须走它。

**绝不能用 `count()` 发号** —— 并发插入会算出相同序号，撞上 `@@unique([roomId, sequence])`。也不用 `updateMany` 后自己读，除非在同一个事务里（InnoDB 的行锁撑到提交才保证不交叉）。

### 4. Run 控制命令的 409 必须在客户端处理

`POST /rooms/:roomId/runs/:runId/commands` 带 `status` + `version` 双条件，拒绝覆盖服务端没被读过的状态：

| 响应 | 含义 | 客户端该做什么 |
|---|---|---|
| `409 unknown_transition` | 当前状态没有这条边（如 `queued` 上 `pause`） | 重读状态并按新状态出按钮 |
| `409 concurrent_update` | 读写之间状态被别人推进了 | **重读、按当前状态重选命令、重试** |

这条是端到端实测撞出来的：脚本读到 `queued` 后发 `cancel`，而 Worker 在这中间已把 Run 认领成 `running`。
不处理 409 的前端会表现成"取消按钮时灵时不灵"。可重试的参考实现见 `scripts/verify-e2e.ts` 的 `settleRun()`。

## 改状态机要看 spec，不要改表

`docs/product/state-machines.md` 是转移表的唯一出处，`packages/ai-core` 逐行照抄，`packages/ai-core/src/__tests__/` 逐条断言。非法转移必须返回 `{ok:false, reason}`，不允许静默成功。

轮次语义（规格没写死，这里定死）：**一轮 = 场上每个可发言角色各发言一次**。判断"本轮是否已发言"用持久化的 `RunAgentState.lastSpokeRound`，不新增列，进程崩溃后可自恢复。

## 测试怎么放

| 位置 | 依赖 | 用途 |
|---|---|---|
| `packages/ai-core` | 无 | 状态机、导演、预算、治理检测与阶梯。纯函数 |
| `packages/queue` | 无 | 连接串解析、驱动选择、内存队列 |
| `apps/ai-worker` | 内存假实现 | 调度循环、治理执行、复盘。用 `FakeStore` |
| `apps/api` | 真实 MySQL | 鉴权、授权边界、WS、发号。`app.inject()` 不起端口 |

**API 测试刻意打真库**：授权与唯一约束的 bug 全在 SQL 和真实约束里，用内存替身测等于没测。测试自己负责清理（`afterAll` 按外键安全顺序删）。

`apps/ai-worker` 的 `FakeStore` 会复刻三条真实语义，否则给假绿灯：读出来的是副本、`commitRun` 带 `leaseToken` + `version` 双条件、序号由房间级计数器发出。它的 id 一律用真 uuid —— 假 id 会让 `ModerationEventSchema.parse` 这类校验分支永远走不到。

## 加一张表或一列

```bash
# 1. 改 packages/database/prisma/schema.prisma
pnpm db:migrate:dev --name <snake_case> --skip-seed
# 2. 若客户端类型变了
pnpm db:generate
# 3. 全仓类型检查会告诉你哪里没接上
pnpm typecheck
```

`db:migrate:dev` 必须在仓库根跑（经 `pnpm` 根脚本），因为 Prisma CLI 只从 cwd 和 schema 目录加载 `.env`，而密钥在根。包目录里跑会报 `P1012 Environment variable not found: DATABASE_URL`。

## 验证脚本

三个脚本是分层递进的，出问题时按顺序缩小范围：

- **`pnpm verify:queue`** —— 只验传输。拉起两个子进程，证明一个 job 真的跨进程被消费、一条房间事件真的被订阅端收到。不需要数据库。
- **`pnpm verify:run`** —— 只验导演。单进程认领 Run 跑完一场，检查序号连续、审计落库、终态原因。`pnpm verify:run mock` 可完全离线。
- **`pnpm verify:e2e`** —— 验整条链路和验收条件。要求 API 与 Worker 两个进程已在跑，走 HTTP + 真 WebSocket，逐条输出 `mvp-spec §9` 的 PASS/FAIL。会自己清掉建的房间。

三个都支持用 `.env` 里的真实凭据；`verify:queue` 要求 `QUEUE_DRIVER=bullmq`，否则直接拒绝运行而不是在内存队列上"假装通过"。

## 部署

裸机 + PM2 + nginx，无 Docker。详见 `docs/deployment.md`。

| 目的 | 命令 |
|---|---|
| 本地起 API（调试） | `pnpm start:api` |
| 本地起 Worker（调试） | `pnpm start:worker` |
| 一键发布 | `bash scripts/release.sh` |
| 发布 + PM2 重载 | `RELOAD_PM2=1 bash scripts/release.sh` |

PM2 配置在 `ecosystem.config.cjs`（双进程：`tianma-api` + `tianma-worker`），nginx 配置在 `deploy/nginx-tianma.conf`。

## 已知未完成

- 点名下一位发言者（`mvp-spec §3.4`）尚未实现；`SendMessageInputSchema.mentionRoleId` 目前没有消费者。
