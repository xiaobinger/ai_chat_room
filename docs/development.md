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

## API 端点速查

### 房间与成员

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/rooms` | 登录 | 大厅：我拥有的 + 已加入的 + 公开房间 |
| `POST` | `/rooms` | 登录 | 创建房间 |
| `PATCH` | `/rooms/:roomId` | 房主 | 更新房间 |
| `DELETE` | `/rooms/:roomId` | 房主 | **解散房间**（级联删除所有数据） |
| `POST` | `/rooms/:roomId/join` | 登录 | 申请加入房间 |
| `POST` | `/rooms/:roomId/invite` | 房主 | **邀请成员**（通过 email） |
| `GET` | `/rooms/:roomId/memberships` | 成员 | 成员列表 |
| `POST` | `/rooms/:roomId/memberships/:id/approve` | 房主 | 审批通过 |
| `POST` | `/rooms/:roomId/memberships/:id/reject` | 房主 | 审批拒绝 |
| `DELETE` | `/rooms/:roomId/membership` | 登录 | 退出房间 |

### 讨论控制

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `POST` | `/rooms/:roomId/start` | 房主/允许 | 启动讨论 |
| `POST` | `/rooms/:roomId/runs/:runId/commands` | 房主/允许 | 暂停/继续/终止 |
| `POST` | `/rooms/:roomId/runs/:runId/restart` | 房主 | **重启讨论**（重置轮次和预算） |

### 治理

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `POST` | `/rooms/:roomId/moderation` | 房主 | 手动治理（禁言/移出角色或用户） |
| `POST` | `/rooms/:roomId/events/:eventId/revoke` | 房主 | 撤销治理 |
| `GET` | `/rooms/:roomId/events` | 成员 | 治理事件列表 |

### 消息

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/rooms/:roomId/messages` | 成员 | 消息列表（支持 `?since=` 游标） |
| `POST` | `/rooms/:roomId/messages` | 成员 | 发送消息（人类发言） |

### 娱乐空间

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| `GET` | `/entertainment/rooms` | 登录 | 娱乐房间列表 |
| `POST` | `/entertainment/rooms` | 登录 | 创建游戏房间 |
| `GET` | `/entertainment/rooms/:roomId` | 成员 | 房间详情 + 玩家列表 |
| `POST` | `/entertainment/rooms/:roomId/join` | 登录 | 加入游戏 |
| `POST` | `/entertainment/rooms/:roomId/leave` | 登录 | 离开游戏 |
| `POST` | `/entertainment/rooms/:roomId/invite` | 房主 | 邀请用户 |
| `POST` | `/entertainment/rooms/:roomId/ai` | 房主 | 添加 AI 玩家 |
| `POST` | `/entertainment/rooms/:roomId/start` | 房主 | 开始游戏 |
| `GET` | `/entertainment/rooms/:roomId/state` | 成员 | 获取游戏状态 |
| `POST` | `/entertainment/rooms/:roomId/action` | 玩家 | 游戏动作（含 clueId） |
| `GET` | `/entertainment/rooms/:roomId/review` | 成员 | 获取复盘数据（终局返回全量 events，含 `secret` 夜晚密谋事件） |
| `DELETE` | `/entertainment/rooms/:roomId` | 房主 | 解散房间（游戏进行中不可解散） |
| `GET` | `/entertainment/stats` | 登录 | 获取用户游戏统计 |

### 娱乐空间架构要点

- **模式定位拆分**：`who_is_the_thief` 统一对外展示为“谁是小偷”，保留轻推理社交局定位；真正的凶案沉浸推理由 `murder_mystery`（剧本杀）承担，避免产品命名和实际规则错位
- **多游戏 3D 预埋**：狼人杀之外，剧本杀/谁是小偷/谁是卧底的玩家视角也统一补充 `seatNumber`，共享 `PlayerChips / VoteGrid` 已能显示“几号玩家”，后续可直接映射 3D 座位、镜头位和空间发言顺序
- **剧本杀展示增强**：`MysteryView` 现支持案名、案件档案、线索进度、关键线索数量和嫌疑榜，更强调“案发现场 + 搜证 + 指认”的凶案推理感，与谁是小偷形成清晰区分

### 狼人杀引擎要点（WP19）

- **夜晚待行动**：仅狼人/预言家/女巫有夜晚行动，村民与猎人不进入 `pendingHumans()`（否则夜晚无法结算）
- **女巫行动顺序**：女巫只会在狼人完成夜晚击杀后进入待行动；解药未用时才会获知刀口，被刀目标若是女巫本人则法官不报号，前端以“可能是你自己被杀”提示代替具体号码
- **法官主持词分阶段**：`aiJudgeBroadcast()` 会按夜晚子阶段切换为“狼人请睁眼 → 预言家请睁眼 → 女巫请睁眼 → 等待天亮”，而不是整夜只播一条固定文案；女巫报号与 AI 法官广播统一使用座位号
- **AI 推理策略升级**：`ai-decision.ts` 不再主要依赖随机数，而是综合公开发言、预言家对跳、玩家嫌疑值与夜晚结果来决定狼刀、预言家查验、女巫救/毒、白天发言与投票；策略目标是“只基于公开信息 + 自己私有信息推理”，尽量避免全知视角作弊感
- **猎人开枪**：阵亡猎人（`pendingHunter`）若是人类仍会进入待行动列表，30s 未开枪由超时托管自动收枪
- **秘密事件**：狼刀选择、预言家查验、女巫用药写入 `events`（`type: 'night_action'`、`secret: true`）；
  对局中玩家视角过滤秘密事件并剥离 `role`，法官视角与终局复盘全量可见
- **法官恢复**：`GameDirector.restore()` 从持久化 `gameState` 恢复 `judgeMode/judgePlayerId`，重启后法官身份不丢
- **身份中文化**：前端通用身份标签组件统一把狼人杀/谁是小偷/谁是卧底的原始角色枚举映射成中文，终局“最终身份”与玩家身份标识不再显示英文枚举值
- **座位号基础设施**：狼人杀玩家视角与法官视角统一下发 `seatNumber`，前端玩家卡片、目标选择和女巫夜晚提示统一展示“几号玩家”，为后续语音法官、镜头跟随和 3D 座位布局提供稳定锚点
- **AI 回归测试**：`apps/ai-worker/src/__tests__/games.test.ts` 已覆盖狼人优先刀跳预言家、预言家优先查对跳、女巫被刀优先自救、平民在预言家对跳时优先投对跳位

## 已知未完成

- 剧本杀游戏：更完整的复盘页、观察记录与悄悄话前端展示仍待补齐
- 更多剧本场景和角色卡扩展
