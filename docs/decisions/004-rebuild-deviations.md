# 决策 004：重建对决策 003 的偏离

## 状态
通过

## 日期
2026-09-04

## 决策主题
决策 003 批准的技术栈在实施中未全部落地。本次把仓库重建为可部署 MVP 时，对其中五项做出偏离，并记录理由。

## 背景
接手时仓库无法编译（`pnpm typecheck` 33 个错误）、数据库层为空、AI 从未被真正调用、前端全为硬编码假数据。项目经历过一次未完成的迁移：`prisma/migrations/0_init/migration.sql` 与 `packages/ai-core/dist/*.d.ts` 代表新设计，而 `schema.prisma`（被清空）、`contracts`、`api`、`worker` 停留在旧设计 —— 源码在迁移中途丢失，只剩编译产物。

## 偏离清单

### 1. 移除 Turborepo，改用 `pnpm -r --no-bail`
`turbo` 从未安装，`turbo.json` 是死配置，且用的是 Turbo 1 的 `pipeline` 键（Turbo 2 已改名 `tasks`），即使补装也需重写。7 个包的规模下 `pnpm -r` 的拓扑排序已够用。

同时删除根 `package.json` 的 npm 式 `workspaces` 字段（与 `pnpm-workspace.yaml` 重复且相互矛盾）。

脚本一律带 `--no-bail`：原先遇首个错误即中止，`packages/database` 失败后 api/worker/web 根本没跑，掩盖了错误全貌。

### 2. 数据库 PostgreSQL → MySQL 8.0.36
用户已有可用实例（`192.168.10.204:3306`），未新建 PG。Prisma 6.19.3 下 MySQL 原生 `ENUM` 与 `JSON` 均受支持，已用 `prisma validate` + `migrate diff` 实测确认后再落笔。

方言差异：`JSONB` → `Json`；保留每个 `@db.VarChar(n)`；长文本用 `@db.Text`；`@db.DateTime(3)` 保留毫秒精度。

### 3. 迁移重新基线
`0_init/` 是 PostgreSQL 方言、从未 apply 过、目标库为空。保留会让首次 `migrate deploy` 直接失败，故删除并重建为 `20260904092550_init`（MySQL 方言）。

新基线相对旧 `migration.sql` 的增列：`User.passwordHash`、`Room.messageSeq` 与成员权限开关、`RoomRole.modelName/stance/aggressiveness/priority`、`DiscussionRun.leaseToken/leaseExpiresAt/version/currentRound/settings`、`AgentProfile`、`PenaltyState`、`DiscussionSummary`、`ModerationEvent` 的审计字段。

### 4. apps/api 用纯 Fastify 插件（非 NestJS）、apps/web 用 Vite SPA（非 Next.js）
两者实际代码已经是纯 Fastify 与 Vite + React，决策 003 的表述从未落地。改按现状定性，不为对齐文档而重写。

web 构建产物是静态文件，交给 nginx 直出，比 SSR 更契合"裸机 + PM2 + nginx"的部署要求。

### 5. Node 侧不产出 `dist`，源码直连 + tsx 运行
各包 `main`/`types` 指向 `./src/*.ts`，`tsconfig` 一律 `noEmit`；Node 应用在 dev 与生产都用 `tsx` 启动；只有 `apps/web` 保留 `vite build` 产出静态资源。

理由不是省事：**本项目的崩坏正是陈旧 `dist/*.d.ts` 与已丢失的源码分叉造成的**。让 `dist` 重新成为真相来源之一，等于把同一个故障模式留在线路上。附带收益是不需要构建拓扑排序，也不会出现"改了 src 但忘了 build"。

代价：`tsx` 是生产运行时依赖；启动时有一次 esbuild 转译开销（对长驻服务可忽略）。

### 6. 环境加载：`@tianma/database` 导入时向上查找并加载 `.env`
此前仓库没有任何 dotenv 依赖，tsx 也不自动加载，`JWT_SECRET`/`REDIS_URL`/`MODELS_CONFIG`/`PORT` 在运行时全为 `undefined` —— 而 `undefined` 被静默当成"未配置"，正是队列降级被掩盖的同类故障。

`client.ts` 在模块作用域调用 `loadEnv()`，从 `process.cwd()` 逐级向上找 `.env`（`pnpm --filter <pkg> dev` 会把 cwd 设到包目录，而密钥只在仓库根），并导出 `loadedEnvFile` 供启动日志自证。真实环境变量优先，PM2/CI 注入的值一定压过磁盘文件。

消费者无需任何样板即可获得已灌好的 `process.env`。

## 对已批准实施计划的一处偏离
计划要求 `PenaltyState @@id([runId, targetRoleId])`。实际改为 **房间级** `@@id([roomId, targetRoleId])`。

理由：处罚阶梯（提醒→警告→限时禁言→移出）必须跨 Run 保留。按 Run 存会让每个新 Run 的 `level` 归零，从而出现"未经任何警告直接移出"，违反 `permissions.md` §4"移出前必须已有警告或禁言记录"。`lastRunId` 仍可追溯最近一次触发所在的 Run。

## 后果
- 正面：`pnpm install && pnpm setup` 即可从零到一个已迁移、已灌种子、可编译可测的仓库；不再有 src/dist 分叉空间。
- 负面：决策 003 的技术栈描述需以本文为准；生产环境必须安装 `tsx`，`release.sh` 与 PM2 `script` 都要按 tsx 入口写。
- 待办：MySQL 目前使用 `root` 账号，上线前应换成专用最小权限账号；`sk-*` 模型 Key 与 `JWT_SECRET` 需轮换。
