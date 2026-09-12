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
- **剧本杀主持节奏增强**：剧本杀新增 `accusation`（公开指控）阶段，流程从“搜证 → 圆桌讨论 → 公开指控 → 最终投票”推进，AI 会在投票前给出更像真人桌游的最终怀疑对象与理由
- **卧底描述拟人化**：`who-is-undercover-engine.ts` 中 AI 描述从单一模板升级为“场景 / 感受 / 颜色 / 类别 / 用途 / 排除”多角度描述，且轮次推进时会提醒玩家换角度发言，减少全员复读感
- **谁是小偷案件总结**：谁是小偷在讨论转投票、下一轮调查开始时会自动生成“已公开线索 + 当前焦点人物”的主持式总结，目击者公开线索和市民投票也不再主要依赖随机数
- **多游戏人格标签**：谁是小偷与谁是卧底的 AI 玩家新增稳定人格标签，分别影响发言口吻、带票方式与投票激进度，避免每轮都像“随机说话的同一套 AI”
- **公共局势记忆层**：剧本杀 / 谁是小偷 / 谁是卧底统一增加 `publicNotes`，在阶段切换时沉淀“当前焦点、共识、节奏提醒”，供 AI 下一阶段继续引用，也供前端直接展示给玩家
- **前端人格/记忆展示**：`MysteryView`、`ThiefGameView`、`UndercoverView` 已展示角色性格或人格标签，以及公共局势记忆，让玩家能看到“这名 AI 为什么这么说”和“场上目前形成了什么判断”
- **回归保障补强**：`apps/ai-worker/src/__tests__/games.test.ts` 新增人格与 `publicNotes` 视角测试，防止后续改动把这些拟人化字段回退掉
- **人格深入决策层**：`who-is-the-thief-engine.ts` 不再只让人格影响发言模板，`冷静观察型 / 强势带队型 / 圆滑周旋型 / 直觉冲票型` 现在会影响公开焦点判断、跟票对象和投票激进度
- **卧底票型更像真人**：`who-is-undercover-engine.ts` 中 `谨慎试探型 / 联想发散型 / 稳健跟随型 / 大胆误导型` 已分别影响保留投票、追离群描述、跟随共识和主动带偏的选择
- **剧本杀角色性格接入怀疑链**：`mystery-engine.ts` 开始直接读取角色卡 `character.personality`，用它影响嫌疑排序、发言语气和最终投票，不再只有“统一的推理模板”
- **阶段化氛围背景音乐**：新增 `apps/web/src/hooks/useAdaptiveGameBgm.ts`，通过 `Web Audio API` 在无素材依赖的前提下合成游戏氛围音乐，按游戏类型与阶段映射不同情绪，不需要额外维护音频资源
- **GameRoom 音乐控制条**：`apps/web/src/pages/GameRoom.tsx` 新增音乐控制条，展示当前曲风标签、氛围说明、开关和音量滑杆；首次受浏览器策略限制时可点击“点我唤醒音乐”恢复播放
- **音乐映射策略**：狼人杀区分夜晚/白天/投票压迫感，剧本杀区分入场/搜证/讨论/指控节奏，谁是小偷偏潜行与轻快锁票，谁是卧底偏试探与锁票紧张感，结算阶段统一切到收束型尾声
- **主持总结卡组件**：`apps/web/src/components/game-parts.tsx` 新增 `HostSummaryCard`，统一承载“主持总结 / 当前焦点 / 高亮标签”，避免三套页面各自拼接临时样式
- **三游戏演出层补强**：`ThiefGameView`、`UndercoverView`、`MysteryView` 现已把 `publicNotes` 的最新一条提升为主持总结卡，并把最近 3 条共识做焦点高亮，形成“音乐 + 阶段 + 主持播报”一体化演出感
- **当前验证备注**：本轮前端展示改动已通过 `typecheck` 与 `lint`；全量 `pnpm test` 中仍偶发触发剧本杀既有随机阶段测试，但 `apps/ai-worker` 单独复跑已通过，说明本轮未引入新的前端逻辑回归
- **阶段转场播报**：`apps/web/src/components/game-parts.tsx` 新增 `PhaseSpotlight`，四个游戏在阶段或轮次推进时都会短暂出现转场播报，让玩家更清楚当前局势已经切到哪一段
- **投票锁定反馈**：`VoteGrid` 现在会在点击后立即进入本地“锁票中”状态，并在请求失败时自动回退；玩家能明确感知自己的票已经锁定，而不是点完像没发生
- **结算揭示动画**：`WinnerBanner`、阶段转场卡和投票锁定按钮都补上了更明显的登场/锁定动画，让结算与关键操作更有仪式感
- **关键揭示卡**：`apps/web/src/components/game-parts.tsx` 新增 `RevealBanner`，用于承载“昨夜死亡 / 白天放逐 / 关键结果”这类必须被玩家第一眼看到的信息
- **时间线关键事件高亮**：`Timeline` 现在会在时间线顶部单独提取最近一次关键事件（出局、投票结果、结算等），避免玩家必须自己翻时间线才能知道刚发生了什么
- **狼人杀死亡揭示补强**：`WerewolfView.tsx` 在夜晚结束后会展示“昨夜死亡揭示”，白天放逐后会展示“白天放逐结果”，与临终遗言阶段形成更强的叙事连续性
- **阶段遮罩转场**：`apps/web/src/components/game-parts.tsx` 新增 `StageVeil`，在阶段/轮次推进时提供短暂整屏遮罩，让切场不再只是顶部文案变了
- **焦点联动高亮**：`PlayerChips` 和 `Timeline` 已支持焦点联动，主持总结或嫌疑榜点到的角色会同步高亮到玩家卡片和时间线事件
- **结果逐步揭晓**：新增 `ResultRevealCard`，先用于谁是卧底的词底揭示，改成分步亮相而不是一口气全部摊开
- **游戏 AI 已真正接入模型发言链路**：`apps/api/src/game/game-director.ts` 现在会读取 `GAME_SPEECH_MODEL`（未配置则回落到 `DEFAULT_MODEL/auto`），统一解析出游戏用 `speechProvider`，并注入狼人杀 / 剧本杀 / 谁是小偷 / 谁是卧底四套引擎
- **四游戏发言策略升级为“模型优先，规则兜底”**：`werewolf-game.ts`、`mystery-game.ts`、`thief-game.ts`、`undercover-game.ts` 都会先尝试 LLM 生成发言；模型超时、空响应或端点错误时，立即回退到现有规则模板，不会卡死对局
- **游戏模型调用日志落地**：`apps/ai-worker/src/game/speech-generator.ts` 会输出统一的 `[game-llm] request/success/fallback` 日志，日志里包含游戏类型、玩家、阶段、轮次、provider 名称和 fallback 原因，后续排查“到底有没有调模型”可以直接看 worker/api 日志
- **谁是小偷 / 谁是卧底正式进入异步 AI 发言**：两套游戏原先只有本地同步模板，现已改为异步 `step()` 推进以兼容真实模型请求；`games.test.ts` 新增“模型发言优先使用”和“provider 失败自动回退”回归测试

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

### 游戏推进与 AI 发言收口（2026-09-11）

- **推进循环必须 `await step()`**：`GameDirector.tick()` 里 `step()` 是 async 的，必须先 `await` 再判断是否可继续；未 `await` 会让循环在大模型发言期间空转、同一 AI 并发重复调模型、广播旧状态。今后任何把 `step()` 改成异步的行为都要同步检查导演循环
- **先推进引擎、再看待行动人类**：导演循环改为"先 `step()`（法官播报 + AI 行动）→ 有推进则持久化广播后继续 → 无推进才查 `pendingHumans()`"。这样主持词（尤其女巫报号）会在人类被提示前送达
- **AI 发言两阶段生成（正在输入）**：四套游戏状态统一新增 `typingPlayerId`，第一步只标记"正在输入"并广播让前端展示过渡，第二步才真正调用大模型；前端 `TypingIndicator` 用跳动圆点提示"X 正在输入"
- **女巫报号防泄露**：`getPlayerView()` 只在"解药未用且已知刀口"时下发 `nightVictimSeatNumber`，自己被杀（不报号）或解药用完后一律为 null

### LLM 发言链路与收敛性兜底（WP20，2026-09-11）

- **maxTokens 必须 800**：自建端点 `auto` 路由的后端模型先消耗隐藏推理再出正文，`max_tokens` 偏小（如 200）时高概率整段为空且 `finish_reason=stop`、`completion_tokens` 打满额度。判据与修复详见 project-history WP20
- **空响应/接口错误重试一次，超时不重试**：`generateLlmSpeech()` 内部编排两次 `attemptLlmSpeech()`，`timedOut` 的失败不重试（预算已耗尽）；`cleanupSpeech()` 清理元前缀与包裹引号
- **LLM 失败回退模板发言（不再沉默）**：四款游戏在大模型拿不到可用发言时回退各自模板（`generateDaySpeech` / `generateMysterySpeech` / `generateUndercoverDescription` / `generateInvestigationSpeech`），游戏发言超时统一 30s（独白 30s）
- **多轮投票收敛性**：小偷/剧本杀新增 `consecutiveTies` 可选字段，连续第 3 次平票按累计嫌疑度强制出局/指认（`resolveThiefTiebreak` / `resolveMysteryTiebreak`，与谁是卧底 `resolveTiebreak` 同构）；狼人杀平票后进夜晚、狼人必杀人，天然收敛无需兜底

### 剧本杀冲突演出系统（WP22，2026-09-11）

- **冲突检测入口**：`addDiscussion()` 在 `discussion`/`accusation` 阶段调用 `detectAndGenerateConflict()`；人类 `speak` 与 AI 发言同走此路径，冲突规则对两者一致
- **冲突强度模型**：`EMOTION_BOOST` 情绪词权重（凶手/杀了你/咆哮等）+ 指控/辩解类型加成 + 被重复提及次数 + 性格修正（暴躁/强势 +15，敏感/胆小 -10），clamp 到 5~95；仅当最近存在他人指控且当前发言点名回击被指控相关的指控者时才触发
- **动作梯度与描述池**：`fight`（≥75）/`grab`（≥55）/`shove`（≥35）/`shout`/`threaten` 五级，每级中文描述模板池随机取一条；冲突写入 `conflictEvents` 并同步进 `events`（`type: 'conflict'`）广播
- **状态字段**：`MysteryGameState` 新增 `conflictLevel`（0~100，每次冲突累加 `intensity * 0.4`）与 `conflictEvents`；`getPlayerView()` 两种视角均下发
- **冲突 BGM 联动**：`useAdaptiveGameBgm` 的 `GamePhaseInput` 新增 `conflictLevel`，`GameRoom.tsx` 从视图透传；剧本杀讨论/指控阶段冲突 ≥50 时 profile key 追加 `:conflict` 并切换"冲突爆发"配置（tempo 112、锯齿波、accentEvery 2），冲突回落后自动切回
- **前端演出**：`MysteryView` 冲突警戒条（≥40 elevated / ≥70 critical 含 UI 震动与整视图 `gameViewShake`）+ 每条发言的 TTS 按钮（`speechSynthesis`，zh-CN，播放高亮、卸载自动停止）

### 剧本杀深度悬疑化（WP23，2026-09-11）

- **帮凶系统**：`assignMysteryRoles()` 在 ≥5 人局以 45% 概率从非凶手/非警察中选出帮凶（与黑警互斥）；帮凶被投出时触发 `PlotTwist { kind: 'identity' }` 身份反转事件，但游戏不结束——必须同时投出凶手和帮凶侦探才算胜利
- **帮凶 AI 行为**：`generateMysterySpeech()` 为帮凶增加独立发言块（讨论阶段引导火力/放大伪证/制造疑点，指控阶段高确信度指控无辜者）；`decideMysteryVote()` 将帮凶视为 `isEvil`（保护凶手、避开真凶）；`speakFor()` LLM 提示词增加帮凶角色专用指令
- **剧情反转系统**：`maybeTriggerTwist(state)` 按轮次触发三种反转——`timeline`（第 2 轮 80%，翻转死亡时间/重置不在场证明/嫌疑度随机化）、`fabricated_clue`（第 2 轮 70%，揭穿已暴露的伪证）、`motive`（第 3 轮 60%，揭露受害者秘密信件）；每次反转写入 `twists` 数组并生成 `type: 'twist'` 事件广播
- **伪证机制**：`initMysteryState()` 注入一条 `isFabricated: true` 的误导线索，指向非凶手玩家；`clueImplicationScore()` 对已暴露伪证返回 0；`resolveMysteryVote()` 指认被嫁祸玩家时触发伪证揭穿
- **彩蛋角色中途入场**：`addLatecomer(state)` 从 `latecomerPool` pop 一个角色 push 进玩家列表（`isLatecomer: true`），自带 `arrivalClue` 加入线索池；`nextMysteryRound()` 第 2 轮 65%、第 3 轮 40%（若尚未有人入场）触发；`isAi()` 重写识别 `npc-*` 前缀自动托管
- **证据链闭环**：关键线索标记 `chainStep`（`means`/`opportunity`/`motive`/`trace` 四环）；前端 `evidence-chain` 进度条实时显示 X/4 环闭合；`resolveMysteryVote()` 根据已闭合环数生成 `chainVerdict`（1-4 环）
- **结算逻辑重写**：`getResults()` 帮凶 win 条件 = 凶手胜且帮凶存活；`generateEpilogues()` 增加"共犯落网/完美共谋/连环反转/迷雾终局"多结局变体
- **前端演出**：`MysteryView` 新增 `twist-banner`（4 种反转各有配色 + 扫光动画）和 `evidence-chain`（4 点圆点 + 连接线 + 闭合高亮动画）

### 狼人杀 3D 模式（WP24，2026-09-11）

- **技术栈**：Three.js + @react-three/fiber (React 渲染器) + @react-three/drei (OrbitControls/Html/PerspectiveCamera) + @react-three/postprocessing (Bloom/Vignette)
- **依赖**：`three@^0.169.0`, `@react-three/fiber@^8.17.0`, `@react-three/drei@^9.114.0`, `@react-three/postprocessing@^2.16.0`, `@types/three@^0.169.0`
- **组件架构**：
  - `PlayerAvatar.tsx` — 胶囊体身体 + 球体头部，角色颜色区分（狼人红/村民灰/预言家紫/女巫绿/猎人琥珀），当前行动者头顶金色圆锥，死亡角色倒地 + 红色标记，Html overlay 名牌（角色图标 + 名字 + "我"标记）
  - `GameTable.tsx` — 圆柱体圆桌 + 座位标记 + 中央点光源（夜晚橙色/白天金色）
  - `Environment3D.tsx` — 程序化树木（树干 + 圆锥树冠）、篝火（木柴 + 闪烁点光 + 火焰圆锥）、旋转月亮、星空粒子、昼夜雾色切换
  - `WerewolfScene.tsx` — Canvas 包装器，PerspectiveCamera 俯视角度，OrbitControls 约束旋转角度，Bloom 后处理（夜晚更强）+ Vignette 暗角
  - `Werewolf3DView.tsx` — 主组件，包含 HUD（阶段/轮次/倒计时）、侧边栏（身份卡 + 玩家列表 + 时间线）、底部交互面板（发言/行动/确认）
- **座位布局**：按 `seatNumber` 环形排列，半径自适应（≤4 人 r=2, ≤6 人 r=2.5, ≤8 人 r=3, >8 人 r=3.5）
- **交互流程**：点击行动按钮 → 进入交互模式 → 点击 3D 角色选中（高亮 + 缩放）→ 底部确认面板执行动作
- **集成方式**：`GameRoom.tsx` 新增 `is3DMode` 状态 + 右上角浮动切换按钮（`.werewolf3d-toggle`），条件渲染 `Werewolf3DView` 或 `WerewolfView`
- **样式**：`app.css` 新增 `.werewolf3d*` 系列（Grid 布局 HUD+Stage+Sidebar，面板毛玻璃效果，响应式窄屏适配）

## 已知未完成

- 剧本杀游戏：更完整的复盘页、观察记录与悄悄话前端展示仍待补齐
- 更多剧本场景和角色卡扩展
