# 天马不行空 — 项目开发历程

## 2026-09-03：项目启动与阶段 A 产品规格

### 关键事件
- 用户提出 AI 多角色聊天室产品构想
- 完成阶段 A 产品规格文档：
  - `docs/product/mvp-spec.md`
  - `docs/product/information-architecture.md`
  - `docs/product/flows.md`
  - `docs/product/state-machines.md`
  - `docs/product/permissions.md`
- 门 A 决策记录完成：
  - `docs/decisions/001-mvp-scope.md` 状态更新为"通过"
- 产品定名"天马不行空"

### 核心决策
- 采用"方案拍板 → UI/产品原型拍板 → 工程实施拍板"三道门流程
- 讨论必须由服务端 DiscussionDirector 调度，不允许角色无限互相触发
- 治理采用确定性规则 + AI 语义判断 + 处罚阶梯三层结构
- 首版明确不做语音视频、公开角色市场、跨房间长期关系、高风险工具、企业多租户

### 遇到的问题
- 工作区初始为空目录
- Windows 环境下 `\\?\` 路径导致 CMD 无法执行
- 预览服务进程不稳定，浏览器访问 127.0.0.1:4173 反复失败

## 2026-09-03：阶段 B 可点击原型

### 关键事件
- 创建 React + TypeScript + Vite 原型工程
- 完成六个核心页面：
  - 大厅 `/rooms`
  - 五步创建向导 `/rooms/new`
  - 多角色聊天室 `/rooms/:id`
  - 角色工坊 `/roles`
  - AI 管理员规则 `/rooms/:id/moderation`
  - 讨论复盘 `/rooms/:id/runs/:runId/review`
  - 设置 `/settings`
- 实现核心交互：
  - 创建向导五步切换
  - 聊天室暂停/恢复
  - 模拟偏题治理与撤销
  - 移动端抽屉布局
- 完成产品重命名"零帧起手" → "天马不行空"
- 新增聊天室加入申请功能原型

### 技术细节
- 使用 `webapp-building` skill 初始化项目
- 采用 0-origin 模板，配置 Tailwind CSS + shadcn/ui
- 修复 ESLint 配置，排除 `src/components/ui/**` 避免生成组件报错
- 解决 Windows 路径问题，使用 `cd /e/...` 替代 `cwd` 参数
- 使用 PowerShell Start-Process 启动独立预览进程

### 遇到的问题
- Playwright 浏览器二进制下载超时
- Chrome 自动化测试稳定失败，时间超限
- 浏览器附加工具无法连接到本地预览服务
- 已改为手动浏览验收，并在决策文件中如实记录

## 2026-09-03：门 B 拍板与门 C 启动

### 关键事件
- 门 B 决策记录完成：
  - `docs/decisions/002-prototype-approval.md` 状态更新为"通过"
- 门 C 决策记录完成：
  - `docs/decisions/003-implementation-approval.md` 状态更新为"通过"
- 创建正式工程 Monorepo 结构：
  - `package.json`
  - `pnpm-workspace.yaml`
  - `turbo.json`
  - `.env.example`
  - `.github/workflows/ci.yml`
- 完成 UI 素材提炼：
  - `docs/design/ui-materials.md`
  - `prototype/src/styles/tokens.css`
- 完成项目开发历程文档：
  - `docs/project-history.md`

### 技术选型
- Monorepo：pnpm workspace + Turborepo
- Web：Next.js + React + TypeScript + Tailwind CSS + shadcn/ui
- API：NestJS + Fastify + WebSocket
- AI Worker：独立进程，模型 Adapter + Run 状态机
- 数据库：PostgreSQL + Prisma
- 队列/缓存：Redis + BullMQ
- 共享协议：packages/contracts
- 调度/治理：packages/ai-core

## 2026-09-03：门 C 工程阶段

### C-1 共享契约与数据库 Schema
- 共享契约：`packages/contracts`
- 数据库：`packages/database`
- 状态：骨架与类型已完成

### C-2 API、WebSocket、权限与治理骨架
- 应用：`apps/api`
- 状态：路由、WebSocket、membership、moderation、runs 插件骨架已完成

### C-3 正式 Web 界面骨架
- 应用：`apps/web`
- 状态：路由、页面骨架已完成

### C-4 AI Worker 骨架
- 应用：`apps/ai-worker`
- 状态：DiscussionDirector 骨架已完成

### C-5 测试与文档骨架
- 状态：基础测试骨架和启动文档已落地

## 2026-09-04 ~ 09-06：阶段 C 重建（从损坏骨架到可运行 MVP）

### 接手时的真实状态
- `pnpm typecheck` 失败，33 个错误；`packages/database/prisma/schema.prisma` 被清空只剩 8 行。
- AI 从未被真正调用：Worker 全程跑 `MockDB`，`model-provider.ts` 没有任何文件 import 它。
- 前端全部硬编码假数据：`RoomWizard` 的"继续"按钮不发请求直接跳伪 ID，聊天室两条写死的消息。
- **项目经历了一次未完成的迁移**：`prisma/migrations/0_init/migration.sql`（PostgreSQL 方言）与
  `packages/ai-core/dist/*.d.ts` 代表"新设计"（含 `settings` JSON、`RunAgentState`、`MessageStatus`），
  而 `contracts`/`api`/`worker` 停留在旧设计（`round`/`budget`/`terminatedReason`）。
  **源码在迁移中途丢失，只剩编译产物。**
- 结论：不是缺打磨，是核心链路物理断裂，无法部署。

### 关键手法：从编译产物反向恢复设计
`packages/ai-core/dist/*.js` 是那份丢失源码唯一的副本。先逐个读出恢复成 TypeScript，
再补 `package.json` 使其成为第 7 个 workspace 成员。**在删除 `dist/` 之前完成恢复**，
顺序不能反。恢复出的 `director.js` 里"平局按 roleId 字典序"这类细节说明它当初是忠于规格的。

### 已确认的四项用户决策
生产数据库 MySQL 8（非 PG）、范围 = 完整 MVP 含治理与复盘、部署 = 裸机 + PM2 + nginx、
鉴权 = 邮箱密码 + JWT 且身份一律服务端从已验签 token 推导。

### 主要交付
- **契约与 schema 重建**：14 枚举 / 13 模型，3 个迁移应用到真实 MySQL 8.0.36。
  旧 PG 迁移删除并重新基线（它从未 apply 过，留着会让首次 `migrate deploy` 直接失败）。
- **队列打通**：`QUEUE_DRIVER` 显式声明。修复前 API 与 Worker 各自 `new MemoryQueue()`，
  两个进程内的内存对象永远不会互相看见，Run 入队后即蒸发。新增 Redis Pub/Sub 事件桥。
- **Worker 真做真事**：单租约 + 乐观并发（全部条件更新，绝不 read-then-write）、
  房间级原子发号、`AbortSignal.timeout`、预算三维、调度审计落库。
- **API 鉴权与授权**：注册/登录/JWT、房间级授权守卫、WS 握手鉴权。
- **AI 管理员与复盘**：混合检测器、不可变版本化策略、处罚阶梯、可追溯复盘。
- **验证脚本三件套**：`verify:queue`（跨进程投递）、`verify:run`（真实模型跑完一场）、
  `verify:e2e`（逐条验 §9 七条验收）。

### 实测发现并修掉的缺陷
只有在真实 MySQL / Redis / 模型端点上才会暴露，纸面推演想不到：

1. **`MODELS_CONFIG` 在 `.env` 里是多行 JSON**，dotenv 在第一个换行处截断取值 → 解析成 `"["`
   → 所有角色静默跑 mock，而界面显示的是真模型名。另：模型名含撇号会破坏取值。
2. **Redis 开了 `requirepass`**，缺密码时 BullMQ 不报错而是无限重连，把任务静默卡住。
3. **Worker 从不续租**：真实模型单次调用三十秒，跑满一场远超按"一次发言"算出的租约时长，
   于是自己把租约熬过期，下一轮被判"租约被夺走"而退出，Run 永远停在 `running` 无人认领。
4. **暂停后仍有 AI 消息落地**（直接违背验收 #4）：模型调用进行的几十秒里房主按了暂停，
   而租约只在循环开头检查。改为落库前复核租约，失败则丢弃该条发言、但 token 照常入账。
5. **`consecutiveTurns` 无衰减**：落库值只在"上一轮确实发过言"时才成立，
   缺这个衰减会让"最多连续 2 轮"变成"发言 2 轮后被永久排除"，全员挡死后以
   `no_available_agents` 提前收场。
6. **`budget.onTokensSpent` 从未被调用** → `token_budget` 这一维永远打不满。
7. **模型失败被伪装成内容返回**（"（模型调用失败）"），会喂给下一个角色，
   治理与复盘全部失真。改为一律抛错并走 `CALL_FAILED`。
8. **端点偶发返回空内容**会让角色永久 `error`。补上"跨过一整轮后系统 RESET 回 idle"，
   并用 `ROLE_ERROR_CEILING` 兜住真正配坏的角色。
9. **`PATCH /runs/:id/status` 允许客户端直接指定目标状态**，绕过整个状态机。
   改为事件驱动的 `POST .../commands`。
10. **`jobId: runId` 会让 BullMQ 吞掉恢复任务**（与首次启动的 id 撞上、且旧任务仍在
    completed 保留窗口内）→ 表现为"恢复"按了没反应。改为把 jobId 绑到递增出的 version。
11. **Fastify 的请求解析类错误落到 500**（空 JSON 体等），既给错状态码又污染错误日志。
12. **测试替身用 `"room-1"` 这类假 id**，使 `ModerationEventSchema.parse` 校验分支永远走不到；
    广播被一个过宽的大 catch 吞掉时，表现为"治理检测失败"而实际数据已正确落库。
    假实现改用真 uuid，并把广播与落库的失败路径分开。
13. **`verify:queue` 依赖了环境状态**：真实 `dev:worker` 在跑时会抢走它的测试 job，
    同一个脚本从"打通"变成"消费端超时"。改走隔离队列 `discussion-runs-verify` 之后，
    又踩到 BullMQ 禁止队列名含冒号。**诊断脚本必须与在线进程隔离，否则结论不可重复。**
    两端是否使用同一个队列名仍由 `verify:e2e` 覆盖（它走真实的 `RUN_QUEUE_NAME`）。

### 顺带修掉的既有 bug
- `plugins/database.ts` 自己 `new PrismaClient()` → 两个连接池。删除该文件，统一用单例。
- `memberships.ts` 双前缀（真实路径是 `/api/v1/rooms/rooms/:roomId/...`）+ `import { prisma } from '../main'` 循环依赖。
- 所有路由的身份都从请求体取；治理接口信任 `x-user-id` 头；WS 完全无鉴权。
- `GET /rooms/:id` 泄露成员邮箱；`orderBy: {id:'desc'}` 按随机 UUID 排序；跨房间读 run 无校验。
- 系统消息 `sequence` 恒为 0，撞唯一索引且排序错乱。
- Prisma DLL 被上一会话遗留的 7 个 `tsx watch` 进程锁住，导致 `prisma generate` EPERM。

### 决策与偏离
全部记入 `docs/decisions/004-rebuild-deviations.md`：移除 Turborepo（从未安装）、
PG→MySQL、迁移重新基线、纯 Fastify + Vite SPA 而非 NestJS/Next、
**Node 侧不产出 `dist`**（本次崩坏的直接成因）、环境加载收进 `@tianma/database`。

对批准计划另有三处实现期偏离：`PenaltyState` 改为房间级（否则新 Run 里会"未经警告直接移出"）、
新增 `RunScheduleAudit` 表（§6 要求调度评分可审计）、`RunAgentState` 增 `lastErrorRound` 列
（端点抖动实测逼出来的恢复节流）。

### 当前状态
- 全仓 `pnpm typecheck` 零错误（含根 `scripts/`）；189 个单测全绿。
- `mvp-spec §9` 七条验收条件全部用真实进程拓扑实测通过，见 `docs/verification.md`。
- `pnpm lint` 全通（7 包通过，仅 5 条 no-console warning）。
- CI workflow 已接 MySQL 8 + Redis 7 service containers。
- 部署产物齐全：`ecosystem.config.cjs` / nginx / `release.sh` / `docs/deployment.md`。
- `apps/web` 已接通后端，浏览器实测全链路通过。
- 人类可参与辩论（发言影响 AI 走向）、房主可禁言/移出人类、可解散房间、可重启讨论、可邀请成员。
- AI 角色间支持 @点名 发言。

### 未结的安全事项
- 模型 API Key 已明文落盘并进入会话上下文，建议轮换。
- MySQL 仍用 `root`，`.env` 里已写好建最小权限账号的 SQL。
- `JWT_SECRET` 强度不足。
- 仓库已纳入 git（3 个初始 commit + 2 个 WP8 commit），CI workflow 已配置但尚未在 GitHub 上实际跑过。

## 2026-09-07：WP9 人类参与 + 房主治理增强

### 关键事件
- **AI 发言截断修复**：`maxTokensPerMessage` 默认 800→1500，覆盖 contracts、schema default、seed。
- **人类参与辩论**：
  - 导演检测最近 3 条有人类发言时，给 AI 角色 relevance 加分（进攻性高的角色更容易被选中回应）
  - 人类发言创建后异步做治理检测（`human-moderation.ts`），命中规则写治理事件 + 处罚（PenaltyState.userId 维度）
- **房主治理增强**：
  - `Membership` 加 `mutedUntilRound` 字段
  - `PenaltyState` 改为支持 role/user 双维度（schema 迁移：新增 id 主键、targetRoleId 可空、targetUserId 可空）
  - `moderation.ts` 新增 `applyUserEffect`/`revertUserEffect`
  - 消息创建时检查用户是否被禁言
- **重启讨论**：`POST /rooms/:roomId/runs/:runId/restart` 复制旧 Run 配置创建新 Run
- **房主邀请 + 大厅申请加入**：
  - `POST /rooms/:roomId/invite`：房主输入 email 直接创建 invited 记录
  - 大厅房间卡片显示"申请加入"按钮（非成员，自己房间不显示）
- **角色间 @点名**：AI 发言中 `@角色名` 被导演解析，被点名的角色下一轮优先选中
- **房主解散房间**：`DELETE /rooms/:roomId` 级联删除所有数据
- **UI 优化**：新增 join-btn、mute、invite-row、danger-btn 等按钮样式

### 缺陷修复
- resume 409：继续讨论按钮只在 `paused` 状态显示，`queued` 显示"排队中..."
- penalty id 空约束：发布脚本加 `rm -rf node_modules/.prisma/client` 强制重新生成

### 文档同步
- `development.md`：新增 API 端点速查表、更新已知未完成
- `project-history.md`：更新当前状态、新增 WP9 小节

### 验证
- `pnpm typecheck`：零错误
- `pnpm test`：189 测试全绿
- `pnpm lint`：7 包全过，仅 5 条 no-console warning

## 2026-09-07：WP8 工程收尾（ESLint + CI + 部署）

### 关键事件
- ESLint 9 flat config 修通：修复 JSDoc/ESM 解析冲突、移除 react-hooks 插件与 type-aware 规则。
- 全量 lint 修复：`array-type` 自动修复（`Array<T>` → `T[]`）、`no-unused-vars` 手修、删除 stale disable 注释。
- `.gitignore` 补 `.vite/` 缓存目录。
- CI workflow 升级：分支改 master、加 MySQL 8.0 + Redis 7 service containers（healthcheck 就绪才跑测试）、加 prisma migrate 步骤。
- 部署产物：`ecosystem.config.cjs`（PM2 双进程，worker kill_timeout=600s）、`deploy/nginx-tianma.conf`（反代 + WS 透传 + SPA）、`scripts/release.sh`（一键发布 + 回滚软链）、`docs/deployment.md`（架构图 + 安全清单）。
- package.json 加 `start:api` / `start:worker` / `release` 脚本。
- 文档同步：`docs/development.md` 加部署命令表、`docs/project-history.md` 更新当前状态。

### 验证
- `pnpm lint`：7 包全过，仅 5 条 no-console warning。
- `pnpm typecheck`：零错误。
- `pnpm build`：前端 1728 modules 构建成功。
- `pnpm test`：189 测试全绿（ai-core 78 + queue 22 + ai-worker 58 + api 31）。

## 2026-09-07：WP10 娱乐空间 + 聊天室增强

### 关键事件
- **聊天室增强**：
  - 人类发言影响辩论（导演优先选 AI 回应人类）
  - @点名系统（输入框自动补全、只高亮匹配参与者、显示面具昵称）
  - 房主治理增强（禁言/移出人类+AI、解除禁言、解散房间）
  - 身份标识徽章（房主/AI/主持人/参与者/观察者/游戏角色）
  - 面具昵称（成员可设置房间内显示名）
  - AI 发言不截断（maxTokens 800→1500，预算检查改到发言后）
  - 房间默认可见性改为 public

- **娱乐空间**：
  - Phase 1：数据库模型（RoomType/GameType/GameStatus/PlayerRole + GamePlayer）、API 插件、前端页面
  - Phase 2：狼人杀核心逻辑（角色分配、阶段切换、AI 决策、胜利判定）
  - Phase 3：实时 WebSocket 推送、游戏 UI（阶段指示器/玩家列表/发言/投票/复盘）
  - 复盘回放（事件日志 + 时间线 + 玩家身份揭晓）

- **CI 修复**：
  - 修复所有 lint 错误（未使用变量、类型不匹配）
  - CI workflow 保持稳定

### 验证
- `pnpm typecheck`：零错误
- `pnpm test`：189 测试全绿
- `pnpm lint`：0 errors（仅 warnings）

## 2026-09-08：WP11 娱乐空间扩展（谁是凶手 + 剧本杀）

### 关键事件
- **谁是凶手游戏**：
  - 完整游戏引擎（角色分配、调查、投票、胜利判定）
  - 彩蛋角色：神偷（金蝉脱壳）、同伙、目击者
  - 彩蛋事件：剧情反转、隐藏证据、密信等
- **剧本杀游戏**：
  - 角色卡系统（背景故事、秘密、目标）
  - 线索卡系统（可发现的关键/普通线索）
  - 多阶段流程：介绍→调查→讨论→投票→真相揭晓
  - AI 角色扮演（根据性格生成发言）
  - 4 个剧本场景 + 8 个角色卡 + 多条线索
- **其他**：
  - 房间搜索/筛选功能
  - 游戏统计 API（胜率/场次）
  - 前端 mentionRoleId 接通

### 验证
- `pnpm typecheck`：零错误
- `pnpm test`：189 测试全绿
- `pnpm lint`：0 errors

## 2026-09-08：WP12 娱乐空间游戏全面重构 + 谁是卧底

### 关键事件
- **统一游戏引擎架构**：
  - 新建 `BaseGameEngine` 抽象基类，四游戏实现统一接口：`step/pendingHumans/phaseDeadlineMs/handleAction/autoAct/getView/getState/isFinished/getResults/getRoles`
  - 废弃旧运行器（game-runner / mystery-runner / thief-game-runner），改为 BaseGameEngine 子类
- **GameDirector 编排器**（`apps/api/src/game/game-director.ts`）：
  - AI 自动推进 + 人类玩家等待 + 阶段超时托管（到点 autoAct，游戏永不卡死）
  - 状态持久化（每步写 DB `Room.gameState`）+ 进程重启恢复
  - WS 广播 `game_state_updated` 事件（含 phase/round/deadline）
  - 结束结算（角色/胜负写回 `GamePlayer.gameData`）
- **新增"谁是卧底"游戏**：
  - 引擎 `who-is-undercover-engine.ts` + 运行器 `undercover-game.ts`
  - 4-12 人，描述阶段 + 投票阶段双循环
  - 内置 48 对近似词库（可乐/雪碧、包子/饺子…）
  - AI 描述用词哈希生成稳定提示，AI 投票按嫌疑度启发式
- **狼人杀关键修复**：
  - 女巫药剂改为即时消耗（applyWitchAction 时），重复用药直接报错
  - 预言家死循环：所有存活者查验完后 `decideSeerCheck` 返回 undefined，用自身 playerId 占位标记
  - `getResults` / `getRoles` 使用中文角色标签
- **谁是凶手修复**：人类投票、侦探私密结果、视角净化、观众模式
- **剧本杀修复**：人类动作、视角净化、观众模式（`getPlayerView` 的 playerId 改为 `string | null`）
- **前端全面重写**：
  - `GameRoom.tsx`：WS 实时 + 4s 轮询兜底，waiting/playing/finished 三态分流
  - 四个游戏视图组件：`WerewolfView` / `ThiefGameView` / `MysteryView` / `UndercoverView`
  - 共享 UI 库 `game-parts.tsx`：Countdown / PhaseBadge / RoleCard / VoteGrid / Timeline / SpeechInput
  - `useGameRoomSocket.ts`：游戏房 WS hook，指数退避重连
- **防作弊**：
  - `guards.ts` 的 `isRoomParticipant` 增加 GamePlayer 检查，游戏房普通玩家可连 WS
  - 对局中 `GET /rooms/:id` 和 `/review` 隐藏 gameState
  - `game_started` payload 的 gameState 改为 optional
- **测试**：新建 `games.test.ts`，16 个游戏测试覆盖四游戏完整对局流程、视角净化、道具限次消耗、重启恢复

### 验证
- `pnpm typecheck`：7 包零错误
- `pnpm test`：74 测试全绿（含 16 个游戏测试）
- `pnpm lint`：0 errors

## 项目历程总结

| 日期 | 阶段 | 关键产出 | 状态 |
|------|------|----------|------|
| 2026-09-03 | 阶段 A | 5 份产品规格 + 门 A 通过 | ✅ |
| 2026-09-03 | 阶段 B | 可点击原型 + 门 B 通过 | ✅ |
| 2026-09-03 | 门 C 启动 | Monorepo + 门 C 通过 + UI 素材 + 项目历程 | ✅ |
| 2026-09-03 | 门 C 工程 | 各包骨架；因迁移中途丢失源码而整体不可编译 | ⚠️ 已被重建 |
| 2026-09-04~06 | 阶段 C 重建 | 契约+schema+队列+Worker+鉴权+治理+复盘；§9 七条验收实测通过 | ✅ |
| 2026-09-07 | WP8 工程收尾 | ESLint 全通 + CI（MySQL/Redis）+ 部署产物 + 文档 | ✅ |
| 2026-09-07 | WP9 人类参与+治理增强 | 人类参与辩论、房主禁言/移出/解散、重启讨论、邀请加入、@点名 | ✅ |
| 2026-09-07 | WP10 娱乐空间+聊天室增强 | 娱乐空间 Phase 1-3、@点名系统、身份徽章、面具昵称、复盘回放 | ✅ |
| 2026-09-08 | WP11 娱乐空间扩展 | 谁是凶手+剧本杀游戏、彩蛋角色/事件、搜索筛选、游戏统计 | ✅ |
| 2026-09-08 | WP12 游戏全面重构 | BaseGameEngine 统一架构、GameDirector 编排器、谁是卧底、四游戏商用化 | ✅ |
| 2026-09-09 | WP13 卧底多轮投票修复 | resolveTiebreak 函数、consecutiveTies 字段、checkUndercoverVictory 修正 | ✅ |
| 2026-09-09 | WP14 房间管理与 AI 增强 | restart/kick/dissolve API、game_restarted WS 事件、卧底 AI 描述与投票策略提升 | ✅ |
| 2026-09-09 | WP15 剧本杀场景扩展 | 8 个专属剧本场景（角色+线索一一对应）、AI 发言引入具体剧本信息（死者/凶器/秘密/关系）| ✅ |
| 2026-09-09 | WP16 剧本杀多轮投票 + 警察角色 | 多轮投票（错投淘汰→继续）、警察/侦探角色、20% 黑警概率、凶手仅存 + 1 非警察才胜利、结尾彩蛋（凶手终被绳之以法）| ✅ |
| 2026-09-09 | WP17 手机版适配 | viewport-fit=cover PWA meta、safe-area-insets、768px/480px 双断点响应式 CSS、touch 优化、pointer:coarse 44px 触控目标、prefers-reduced-motion 无障碍 | ✅ |
| 2026-09-09 | WP18 CI 修复 + 文档规范 | 剧本杀测试断言改为结构验证（随机性轮数）、创建 .trae/rules/project_rules.md 固定文档+Obsidian 同步流程 | ✅ |

## 2026-09-09：WP13 卧底多轮投票修复

### 关键事件
- **卧底游戏无限循环修复**：
  - `checkUndercoverVictory` 原逻辑用 `alive.length <= 3` 判断平民胜利，导致只剩 3 人时误判
  - 修正为：卧底存活数 > 0 且卧底数 ≥ 平民数时卧底胜；否则平民胜
  - 新增 `resolveTiebreak()` 函数处理连续平票（≥3 次后按嫌疑度最高者自动淘汰）
  - `initUndercoverState` 补上缺失的 `consecutiveTies: 0` 字段

### 验证
- `pnpm typecheck`：零错误
- `pnpm test`：74 测试全绿
- `pnpm lint`：0 errors

## 2026-09-09：WP14 房间管理与 AI 增强

### 关键事件
- **房间管理 API**：
  - `POST /rooms/:roomId/restart` — 房主重置房间，清空所有玩家后重新加入房主
  - `DELETE /rooms/:roomId/players/:playerId` — 房主踢出人类玩家（游戏中不可踢）
  - `DELETE /rooms/:roomId` — 房主解散房间（游戏中不可解散）
- **前端增强**：`GameRoom.tsx` 新增"再来一局""踢出""解散房间"按钮，游戏结束后显示管理按钮
- **WebSocket 事件**：新增 `game_restarted` 事件；`game_player_left` payload 增加可选 `nickname`
- **卧底 AI 策略提升**：卧底描述走中间路线避免极端，投票时优先选择与自身描述距离最远的玩家

### 验证
- `pnpm typecheck`：零错误
- `pnpm test`：74 测试全绿
- `pnpm lint`：0 errors

## 2026-09-09：WP15 剧本杀场景扩展

### 关键事件
- **剧本数据结构重构**：从全局共享角色池+线索池改为 `MysteryScenario` 专属数据模型
- **扩展为 8 个剧本场景**：古宅疑云、游轮迷案、剧院幽灵、雪山旅馆、东方列车谋杀、实验室疑案、寺庙命案、庄园晚宴
- **AI 发言智能提升**：引入死者姓名、凶器名称、角色秘密、人际关系、发现的线索等上下文；不同角色发言风格差异化

### 验证
- `pnpm typecheck`：零错误
- `pnpm test`：74 测试全绿
- `pnpm lint`：0 errors

## 2026-09-09：WP16 剧本杀多轮投票 + 警察角色

### 关键事件
- **多轮投票机制**：错误指控→淘汰被投者继续；平票→无人出局继续；正确指控→侦探胜利；仅存凶手+≤1非警察→凶手胜利
- **警察/侦探角色**：每剧本新增一名警察角色，20% 概率为黑警（与凶手勾结）
- **结尾彩蛋**：无论胜负，彩蛋事件显示凶手（和可能的黑警）最终被绳之以法
- **投票决策 AI 提升**：普通玩家参考线索投票；侦探优先投票符合调查方向；凶手/黑警保护凶手或嫁祸无辜者

### 验证
- `pnpm typecheck`：零错误
- `pnpm test`：74 测试全绿
- `pnpm lint`：0 errors

## 2026-09-09：WP17 手机版适配

### 关键事件
- **viewport 配置**：`viewport-fit=cover`、`maximum-scale=1`、PWA meta 标签
- **安全区域适配**：CSS 变量 `--safe-top/bottom/left/right` 使用 `env(safe-area-inset-*)`
- **响应式断点**：
  - 768px：单列布局、水平滚动玩家列表、紧凑工具栏、双列线索/投票
  - 480px：网格工具栏、全宽投票按钮（44px）、堆叠词卡、全屏表情/提及选择器
  - 横屏优化（≤900px）、pointer:coarse 触控目标（≥44px）、prefers-reduced-motion
- **触摸优化**：`-webkit-tap-highlight-color`、`touch-action:manipulation`、`overscroll-behavior-y:contain`

### 验证
- `pnpm typecheck`：零错误
- `pnpm build`：CSS 42KB / JS 364KB
- `pnpm lint`：0 errors

## 2026-09-09：WP18 CI 修复 + 文档规范

### 关键事件
- **CI 测试修复**：剧本杀阶段断言改为结构验证（`toBeGreaterThanOrEqual(4)` + 按 `['investigation','discussion','voting']` 循环校验），兼容单轮和多轮两种场景
- **文档规范固化**：创建 `.trae/rules/project_rules.md`，固定每次任务完成后同步 `docs/project-history.md` 和 Obsidian 归档

### 验证
- `pnpm typecheck`：7 包零错误
- `pnpm test`：74 测试全绿
- `pnpm lint`：0 errors

## 2026-09-09：WP19 大厅解散按钮 + 狼人杀卡死修复 + 复盘全细节

### 关键事件
- **大厅卡片解散房间**：娱乐大厅房间卡片新增房主专属「解散」按钮（`EntertainmentLobby.tsx`），
  复用既有 `DELETE /entertainment/rooms/:roomId` 接口，游戏中（playing）不可解散
- **狼人杀卡死根因（两个，均在人类成为普通玩家后暴露，AI 法官模式首次触发）**：
  1. **人类村民之夜死循环**：`pendingHumans()` 夜晚分支把无夜晚行动的村民/猎人也算作待行动，
     超时托管对村民无操作 → 每 60s 重试 → 夜晚永不结算。修复：夜晚仅狼/预言家/女巫进入待行动列表
  2. **人类猎人开枪硬卡死**：阵亡猎人不在存活列表，`pendingHumans()` 的 `alive.some()` 判断恒为 false
     → 返回空；`step()` 遇人类待开枪返回 false → GameDirector `!moved` 分支不广播不设超时 → 永久停滞。
     修复：待开枪猎人（无论死活）只要是非 AI 即进待行动列表，由 30s 超时托管兜底（自动收枪）
- **防御性加固**：`stepNight`/`autoAct` 狼刀无可选目标时写入 `'__pass__'` 哨兵防空转；
  GameDirector `!moved` 分支补 `broadcastState()`；`GameDirector.restore()` 从持久化状态恢复
  法官身份（修复重启后房主法官无法发言）
- **复盘全细节**：夜晚动作写入秘密事件（`night_action` + `secret: true`）——每狼刀口选择、
  预言家查验结果、女巫救/毒/空过；对局中玩家视角过滤秘密事件（防身份泄露），法官视角与
  终局复盘全量公开；复盘页新增「夜晚密谋/法官/临终遗言」事件标签、轮次·阶段标注与「秘密」徽标

### 验证
- 新增 4 个回归测试：AI 法官全 AI 对局完整跑完、人类村民在场夜晚不阻塞、人类猎人阵亡进待行动、
  复盘秘密事件记录且对局中不泄露
- `pnpm typecheck`：7 包零错误
- `pnpm test`：109 测试全绿（ai-worker 78 + api 31）
- `pnpm lint`：0 errors

## 2026-09-10：狼人杀女巫规则修正 + 身份标签中文化

### 关键事件
- **女巫夜晚顺序修正**：`WerewolfGame.pendingHumans()` 不再让人类女巫在狼人行动前提前进入待行动列表；女巫夜晚面板会先等待狼人行动结束，再进入是否用药决策
- **女巫报号规则修正**：`getPlayerView()` 新增女巫夜晚状态字段，解药未用且刀口不是自己时才展示被杀玩家；若法官不报号，则前端改为提示“可能是你自己被杀”，同时仍允许女巫自救；解药用完后不再暴露刀口
- **身份中文化兜底**：通用 `PlayerChips` 组件新增跨游戏角色枚举到中文标签的统一映射，终局“最终身份”和玩家身份标识不再显示 `werewolf` / `witch` / `undercover` 等英文枚举

### 技术细节
- 后端文件：`apps/ai-worker/src/game/werewolf-engine.ts`、`apps/ai-worker/src/game/werewolf-game.ts`
- 前端文件：`apps/web/src/components/WerewolfView.tsx`、`apps/web/src/components/game-parts.tsx`
- 回归测试：`apps/ai-worker/src/__tests__/games.test.ts` 新增 3 条用例，覆盖“女巫等待狼人后再行动”“女巫被刀不报号但可自救”“解药用完后不再知道刀口”

### 验证
- `pnpm typecheck`：7 包零错误
- `pnpm test`：全仓测试通过
- `pnpm lint`：0 errors，保留既有 `console` warnings

## 2026-09-10：狼人杀座位号体系 + AI 法官分阶段主持

### 关键事件
- **夜晚主持词升级**：`aiJudgeBroadcast()` 从“整夜一条固定文案”升级为按子阶段切换，依次播报狼人、预言家、女巫和夜晚结束提示；女巫阶段会结合真实规则，在解药未用时按座位号报号，被刀目标若是女巫本人则改为“不报号”文案
- **座位号体系落地**：狼人杀玩家/法官视角统一补充 `seatNumber`，前端玩家卡片、夜晚目标按钮、猎人开枪、女巫提示全面显示“几号玩家”，让主持词与界面信息一致
- **3D 演进预埋**：座位号成为稳定 UI 锚点，为后续做 3D 房间站位、镜头切换、空间语音法官播报保留基础数据层

### 技术细节
- 后端文件：`apps/ai-worker/src/game/werewolf-engine.ts`
- 前端文件：`apps/web/src/components/WerewolfView.tsx`、`apps/web/src/components/game-parts.tsx`
- 回归测试：`apps/ai-worker/src/__tests__/games.test.ts` 新增主持词切换与座位号用例，覆盖 AI 法官夜晚子阶段播报和女巫看到的刀口座位号

### 验证
- `pnpm typecheck`：7 包零错误
- `pnpm test`：全仓测试通过
- `pnpm lint`：0 errors，保留既有 `console` warnings

## 2026-09-10：狼人杀 AI 推理策略升级

### 关键事件
- **狼人 AI 更像真人**：狼人夜晚不再主要随机刀人，而是优先处理公开跳预言家的玩家；若无人对跳，则更偏向刀掉场上更有带队影响力的好人位
- **预言家/女巫/平民判断增强**：预言家优先查验对跳位和高嫌疑玩家；女巫被刀时优先自救，遇到关键好人位更倾向救人，场上对跳混乱或高嫌疑时才更愿意下毒；平民/猎人/女巫白天投票会优先处理预言家对跳和公开压力最高的目标
- **白天发言去模板化**：AI 发言开始结合昨夜结果、场上对跳、最高嫌疑对象来表达观点，不再反复输出空泛模板句

### 技术细节
- 核心策略文件：`apps/ai-worker/src/game/ai-decision.ts`
- 回归测试文件：`apps/ai-worker/src/__tests__/games.test.ts`
- 新增策略测试：狼人优先刀跳预言家、预言家优先查对跳、女巫被刀优先自救、平民在对跳时优先投对跳位

### 验证
- `pnpm --filter @tianma/ai-worker test -- src/__tests__/games.test.ts`：28 测试全绿
- `pnpm --filter @tianma/ai-worker typecheck`：通过
- `pnpm typecheck`：7 包零错误
- `pnpm test`：全仓测试通过
- `pnpm lint`：0 errors，保留既有 `console` warnings

## 2026-09-10：多游戏 3D 基础预埋 + 谁是小偷正名 + 剧本杀档案增强

### 关键事件
- **多游戏座位号统一**：为谁是小偷、剧本杀、谁是卧底的玩家视角补充 `seatNumber`，共享投票按钮和玩家卡片统一显示“几号玩家”，为后续 3D 圆桌站位、镜头聚焦和空间发言顺序提供一致锚点
- **产品定位纠偏**：将 `who_is_the_thief` 在前端大厅、房间页、创建向导、复盘页和 API 配置中的对外名称统一改为“谁是小偷”，不再把小偷局错误包装成“谁是凶手”
- **剧本杀案件感增强**：`MysteryView` 新增案件档案区、案名、线索进度、关键线索数和嫌疑榜，让剧本杀从视觉和信息结构上更像“找凶手”的沉浸式案件推理，而不是轻量社交局

### 技术细节
- 后端文件：`apps/ai-worker/src/game/mystery-engine.ts`、`apps/ai-worker/src/game/who-is-the-thief-engine.ts`、`apps/ai-worker/src/game/who-is-undercover-engine.ts`
- 前端文件：`apps/web/src/components/MysteryView.tsx`、`apps/web/src/components/ThiefGameView.tsx`、`apps/web/src/components/UndercoverView.tsx`、`apps/web/src/components/game-parts.tsx`
- 命名同步：`apps/web/src/pages/EntertainmentLobby.tsx`、`apps/web/src/pages/GameRoom.tsx`、`apps/web/src/pages/GameRoomWizard.tsx`、`apps/web/src/pages/GameReview.tsx`、`apps/api/src/plugins/entertainment.ts`
- 回归测试：`apps/ai-worker/src/__tests__/games.test.ts` 新增多游戏座位号与剧本杀视图字段用例

### 验证
- `pnpm --filter @tianma/ai-worker test -- src/__tests__/games.test.ts`：31 测试全绿
- `pnpm --filter @tianma/ai-worker typecheck`：通过
- `pnpm --filter @tianma/web typecheck`：通过
- `pnpm typecheck`：7 包零错误
- `pnpm test`：全仓测试通过
- `pnpm lint`：0 errors，保留既有 `console` warnings

## 2026-09-10：其他游戏体验增强 + AI 拟人化升级

### 关键事件
- **剧本杀新增公开指控阶段**：流程从“搜证 → 圆桌讨论 → 最终投票”升级为“搜证 → 圆桌讨论 → 公开指控 → 最终投票”，AI 在投票前会给出更像真人桌游的最终怀疑对象与理由，讨论区也开始区分“陈述 / 指控 / 辩解”
- **谁是卧底描述更像真人**：AI 描述不再主要依赖“我同意前面说的”模板，而是按场景、感觉、颜色、类别、用途、排除等角度轮换表达；进入下一轮时会明确提示“换个角度描述”
- **谁是小偷中场总结更有戏**：调查阶段转投票、下一轮调查开始时，系统会总结已公开线索和当前焦点人物；目击者公开线索与平民投票也开始参考场上僵局、公开发言与怀疑集中度

## 2026-09-10：其他游戏人格系统 + 公共记忆层收口

### 关键事件
- **谁是小偷人格落地**：为小偷局玩家加入 `冷静观察型 / 强势带队型 / 圆滑周旋型 / 直觉冲票型`，AI 发言和投票不再只靠嫌疑值，而是开始体现稳定站边与带票风格
- **谁是卧底人格落地**：为卧底局玩家加入 `谨慎试探型 / 联想发散型 / 稳健跟随型 / 大胆误导型`，AI 描述会按人格改变开场语气与激进程度，卧底不再像统一模板输出
- **三游戏公共记忆统一**：剧本杀、谁是小偷、谁是卧底统一引入 `publicNotes`，在阶段切换时沉淀“当前焦点、共识和提醒”，既能让 AI 继续引用，也能直接给前端展示
- **前端体验补齐**：`MysteryView`、`ThiefGameView`、`UndercoverView` 新增人格 / 角色气质 / 场上共识展示，玩家终于能直接看到 AI 的风格线索和局势总结，而不是只看零散发言

### 技术细节
- 后端文件：`apps/ai-worker/src/game/mystery-engine.ts`、`apps/ai-worker/src/game/mystery-game.ts`、`apps/ai-worker/src/game/who-is-the-thief-engine.ts`、`apps/ai-worker/src/game/who-is-undercover-engine.ts`
- 类型文件：`apps/ai-worker/src/game/mystery-types.ts`、`apps/ai-worker/src/game/who-is-the-thief-types.ts`、`apps/ai-worker/src/game/who-is-undercover-types.ts`
- 前端文件：`apps/web/src/components/MysteryView.tsx`、`apps/web/src/components/ThiefGameView.tsx`、`apps/web/src/components/UndercoverView.tsx`、`apps/web/src/components/game-parts.tsx`
- 测试文件：`apps/ai-worker/src/__tests__/games.test.ts` 新增人格与公共记忆视角断言

### 验证
- `pnpm typecheck`：7 包零错误
- `pnpm test`：全仓测试通过
- `pnpm lint`：0 errors，保留既有 `console` warnings

## 2026-09-10：人格进入决策层（第二轮深化）

### 关键事件
- **谁是小偷不再只是“会说话”**：新增公开焦点、线索压力和场上总结驱动的评分，`冷静观察型 / 强势带队型 / 圆滑周旋型 / 直觉冲票型` 已开始真正影响带票与投票选择
- **谁是卧底票型差异拉开**：`谨慎试探型` 会在信号不足时保留，`联想发散型` 更容易追离群描述，`稳健跟随型` 更贴近场上共识，`大胆误导型` 会主动制造偏票
- **剧本杀角色性格开始参与推理**：直接读取角色卡里的 `character.personality`，把“谨慎 / 暴躁 / 敏锐 / 温和”等气质用于嫌疑排序、发言前缀和投票决策，让不同角色更像不同的人

### 技术细节
- 后端文件：`apps/ai-worker/src/game/who-is-the-thief-engine.ts`、`apps/ai-worker/src/game/who-is-undercover-engine.ts`、`apps/ai-worker/src/game/mystery-engine.ts`
- 测试文件：`apps/ai-worker/src/__tests__/games.test.ts` 新增人格深入决策层断言，覆盖小偷局跟焦点、卧底局谨慎保留、剧本杀性格偏向线索指向等场景

### 验证
- `pnpm typecheck`：7 包零错误
- `pnpm test`：全仓测试通过
- `pnpm lint`：0 errors，保留既有 `console` warnings

## 2026-09-10：游戏房间接入阶段化氛围背景音乐

### 关键事件
- **无素材依赖的 BGM 方案落地**：新增 `apps/web/src/hooks/useAdaptiveGameBgm.ts`，使用 `Web Audio API` 合成环境长音、脉冲节拍和高频点缀，避免后续被音频素材管理与打包路径卡住
- **按游戏与阶段精准切歌**：狼人杀按夜晚 / 白天 / 投票切不同压迫感；剧本杀按介绍 / 搜证 / 讨论 / 指控切不同悬疑层次；谁是小偷和谁是卧底也分别补上更贴题的潜行感与试探感
- **GameRoom 增加音乐控制条**：在 `apps/web/src/pages/GameRoom.tsx` 增加可见的曲风标签、描述、开关、音量滑杆和“点我唤醒音乐”按钮，让浏览器自动播放限制也有明确交互出口

### 技术细节
- 接入文件：`apps/web/src/hooks/useAdaptiveGameBgm.ts`、`apps/web/src/pages/GameRoom.tsx`、`apps/web/src/styles/app.css`
- 状态持久化：音乐开关与音量使用本地存储保存，用户切换房间后仍能沿用上一次偏好
- 音乐恢复策略：页面首次交互时自动尝试恢复 `AudioContext`，标签切走时暂停，回到页面后按当前阶段重新恢复

### 验证
- `pnpm typecheck`：7 包零错误
- `pnpm test`：全仓测试通过
- `pnpm lint`：0 errors，保留既有 `console` warnings

## 2026-09-10：主持总结演出层补强

### 关键事件
- **统一主持总结卡落地**：在 `apps/web/src/components/game-parts.tsx` 新增 `HostSummaryCard`，把“主持人正在播报什么、这轮焦点是谁、现在该紧张什么”做成统一演出组件
- **三款轻推理局全部接入**：`ThiefGameView`、`UndercoverView`、`MysteryView` 已把 `publicNotes` 最新一条提升为主卡展示，并只保留最近 3 条场上共识，避免信息墙过长
- **焦点信息更可视化**：最近一条共识会高亮显示，相关人物会被提炼成标签，配合前一轮的背景音乐后，阶段感和桌游主持感明显更强

### 技术细节
- 组件文件：`apps/web/src/components/game-parts.tsx`
- 视图文件：`apps/web/src/components/ThiefGameView.tsx`、`apps/web/src/components/UndercoverView.tsx`、`apps/web/src/components/MysteryView.tsx`
- 样式文件：`apps/web/src/styles/app.css`

### 验证
- `pnpm typecheck`：7 包零错误
- `pnpm lint`：0 errors，保留既有 `console` warnings
- `pnpm test`：全量回归时仍偶发命中剧本杀既有随机阶段测试；`pnpm --filter @tianma/ai-worker test` 单独复跑通过，说明本轮未引入新的展示层回归

## 2026-09-10：沉浸强化线第一轮落地

### 关键事件
- **阶段切换有了转场播报**：新增 `PhaseSpotlight`，四个游戏在阶段或轮次推进时会短暂弹出“当前进入什么阶段、此刻该关注什么”的播报卡
- **投票操作不再“没手感”**：`VoteGrid` 增加本地锁票反馈，点击后会立刻显示“锁票中 / 已锁定”，同时请求失败会自动回退，减少误以为没点上的感觉
- **结算更像结算**：`WinnerBanner`、转场卡和锁票按钮补上揭示与锁定动画，让关键时刻更有桌游主持感和演出感

### 技术细节
- 组件文件：`apps/web/src/components/game-parts.tsx`
- 视图文件：`apps/web/src/components/WerewolfView.tsx`、`apps/web/src/components/ThiefGameView.tsx`、`apps/web/src/components/UndercoverView.tsx`、`apps/web/src/components/MysteryView.tsx`
- 样式文件：`apps/web/src/styles/app.css`

### 验证
- `pnpm typecheck`：7 包零错误
- `pnpm lint`：0 errors，保留既有 `console` warnings
- `pnpm test`：全量回归仍偶发命中剧本杀既有随机测试；`pnpm --filter @tianma/ai-worker test` 单独复跑通过，本轮前端沉浸层未发现新增逻辑回归

## 2026-09-10：沉浸强化线第二轮落地

### 关键事件
- **关键节点有了独立揭示卡**：新增 `RevealBanner`，把“昨夜死亡”“白天放逐”“重大结果”从普通信息块提升为高优先级揭示区域
- **时间线不再只是日志**：`Timeline` 现在会把最近一次关键事件提到顶部单独高亮，玩家不用自己扫完整时间线也能第一眼抓住重点
- **狼人杀死亡信息更有叙事感**：夜晚结束后的死亡名单、白天放逐结果和临终遗言阶段形成连续展示，关键时刻的压迫感与仪式感更强

### 技术细节
- 组件文件：`apps/web/src/components/game-parts.tsx`
- 视图文件：`apps/web/src/components/WerewolfView.tsx`
- 样式文件：`apps/web/src/styles/app.css`

### 验证
- `pnpm typecheck`：7 包零错误
- `pnpm test`：全仓测试通过
- `pnpm lint`：0 errors，保留既有 `console` warnings

## 2026-09-10：沉浸强化线第三轮落地

### 关键事件
- **整屏遮罩转场落地**：新增 `StageVeil`，阶段推进时会出现短暂整屏切场遮罩，终于不再只是“上方 badge 换了个词”
- **焦点信息开始联动**：主持总结里点到的玩家、嫌疑榜上的重点对象，会同步高亮到玩家卡片和时间线事件，信息不再分散在不同区块各说各话
- **结果开始分步揭晓**：新增 `ResultRevealCard`，先用于卧底局词底翻牌，结算时的揭示更像“逐步翻开答案”而不是一次性全部扔出来

### 技术细节
- 组件文件：`apps/web/src/components/game-parts.tsx`
- 视图文件：`apps/web/src/components/WerewolfView.tsx`、`apps/web/src/components/ThiefGameView.tsx`、`apps/web/src/components/UndercoverView.tsx`、`apps/web/src/components/MysteryView.tsx`
- 样式文件：`apps/web/src/styles/app.css`

### 验证
- `pnpm typecheck`：7 包零错误
- `pnpm test`：全仓测试通过
- `pnpm lint`：0 errors，保留既有 `console` warnings

## 2026-09-10：四个游戏 AI 发言正式接入大模型

### 关键事件
- **导演层开始统一注入模型**：`GameDirector` 现在会在创建游戏引擎时解析 `GAME_SPEECH_MODEL` / `DEFAULT_MODEL`，把同一个 `speechProvider` 注入狼人杀、剧本杀、谁是小偷、谁是卧底
- **四个游戏改为“模型优先，规则兜底”**：游戏 AI 发言会先请求模型；若模型超时、空响应或端点报错，则立即退回原有规则模板，不会拖挂对局节奏
- **调用记录终于可见**：`speech-generator.ts` 统一输出 `[game-llm] request/success/fallback` 日志，能直接看到是哪一局、哪个角色、哪个阶段调了哪个 provider，以及是否发生 fallback

### 技术细节
- API 入口：`apps/api/src/game/game-director.ts`
- 游戏引擎：`apps/ai-worker/src/game/werewolf-game.ts`、`apps/ai-worker/src/game/mystery-game.ts`、`apps/ai-worker/src/game/thief-game.ts`、`apps/ai-worker/src/game/undercover-game.ts`
- 公共调用层：`apps/ai-worker/src/game/speech-generator.ts`
- 回归测试：`apps/ai-worker/src/__tests__/games.test.ts`

### 验证
- `pnpm typecheck`：7 包零错误
- `pnpm test`：全仓测试通过
- `pnpm lint`：0 errors，保留既有 `console` warnings

### 技术细节
- 后端文件：`apps/ai-worker/src/game/mystery-game.ts`、`apps/ai-worker/src/game/mystery-engine.ts`、`apps/ai-worker/src/game/who-is-undercover-engine.ts`、`apps/ai-worker/src/game/who-is-the-thief-engine.ts`
- 前端文件：`apps/web/src/components/MysteryView.tsx`、`apps/web/src/components/ThiefGameView.tsx`、`apps/web/src/components/UndercoverView.tsx`
- 测试文件：`apps/ai-worker/src/__tests__/games.test.ts` 已同步剧本杀阶段循环断言，覆盖新增 `accusation` 阶段

### 验证
- `pnpm --filter @tianma/ai-worker test -- src/__tests__/games.test.ts`：31 测试全绿
- `pnpm --filter @tianma/ai-worker typecheck`：通过
- `pnpm --filter @tianma/web typecheck`：通过
- `pnpm typecheck`：7 包零错误
- `pnpm test`：全仓测试通过
- `pnpm lint`：0 errors，保留既有 `console` warnings

## 2026-09-11：游戏推进并发修复 + AI 发言过渡与超时沉默

### 关键事件
- **修复导演推进循环未 await `step()` 的并发 bug**：`GameDirector.tick()` 里 `this.engine.step()` 在 `step()` 改为 async 后没有被 `await`，导致大模型发言期间循环空转、同一 AI 并发重复调模型、广播的都是旧状态——这正是"AI 像卡住 + 发言前后矛盾"的根因之一。改为 `await` 并调整为先推进引擎（法官播报 + AI 行动）再判断待行动人类，让女巫报号等主持词在人类被提示前送达。
- **AI 发言过渡（正在输入）**：四个游戏统一增加 `typingPlayerId` 两阶段生成——先标记"正在输入"并广播，下一步再真正调用大模型；前端 `TypingIndicator` 用跳动圆点 + "正在输入"提示过渡，消除等待时"卡死"观感。
- **LLM 超时保持沉默**：大模型超时 / 空响应 / 出错时，AI 不再回退到随机规则模板（正是"前后矛盾、逻辑不通"的第二来源），而是直接保持沉默跳过本轮发言。
- **发言提示词中文化 + 一致性约束**：`speech-generator.ts` 系统提示词增加"只用简体中文输出"与"立场前后一致、不暴露不该知道的信息"，避免英文输出与自相矛盾。
- **女巫刀口泄露封堵**：`getPlayerView()` 仅在"解药未用且已知刀口"时下发 `nightVictimSeatNumber`，自己被刀 / 解药用完一律不泄露座位号。

### 技术细节
- 后端：`apps/api/src/game/game-director.ts`、`apps/ai-worker/src/game/{werewolf-game,werewolf-engine,mystery-game,thief-game,undercover-game,speech-generator,types,mystery-types,who-is-the-thief-types,who-is-undercover-types}.ts`
- 前端：`apps/web/src/components/{game-parts,WerewolfView,MysteryView,ThiefGameView,UndercoverView}.tsx`、`apps/web/src/styles/app.css`
- 状态字段：四套游戏状态均新增可选 `typingPlayerId`（旧存档缺省为 undefined，向后兼容）
- 回归测试：`games.test.ts` 适配两阶段生成，并把"provider 失败回退模板"改为"失败保持沉默"的断言

### 验证
- `pnpm typecheck`：7 包零错误
- `pnpm test`：全仓 228 测试全绿（ai-core 78 + queue 22 + ai-worker 97 + api 31）
- `pnpm lint`：0 errors，仅保留既有 `console.log` warnings

## 2026-09-11：AI 逻辑漏洞修复（侦探乱投 + 发言编造）

### 关键事件
- **侦探查证后正确投票**：`who-is-the-thief-engine.ts` 里侦探调查结果按 `(\S+) 就是小偷` 解析昵称，遇到"AI 玩家 N"这类带空格的多词昵称只抓到最后一个词，导致"查到了小偷却按嫌疑乱投、把好人投出去"。改为 `parseInvestigationVerdicts()` 按完整昵称匹配并落成 playerId，覆盖发言与投票两处决策。
- **禁止 AI 编造他人发言**：`speech-generator.ts` 系统提示词新增"只能基于给定对话记录发表意见，绝不编造/转述/虚构任何玩家（尤其真实玩家）没说过的话""不要替其他玩家代言或捏造观点"，修复"AI 瞎说真人玩家指认谁有嫌疑"的幻觉。

### 技术细节
- 后端：`apps/ai-worker/src/game/who-is-the-thief-engine.ts`、`apps/ai-worker/src/game/speech-generator.ts`
- 回归测试：`games.test.ts` 新增"侦探查验到小偷后必须投给该小偷（多词昵称）"用例

### 验证
- `pnpm --filter @tianma/ai-worker test`：98 测试全绿
- `pnpm --filter @tianma/ai-worker typecheck`：通过
- `pnpm --filter @tianma/ai-worker lint`：0 errors，仅保留既有 `console` warnings

## 2026-09-11：AI 集体沉默根因修复 + 平票死循环根治（WP20）

### 关键事件
- **定位 AI 集体沉默的根因：端点空响应 + maxTokens 过小**。用 Node 探针直打
  `192.168.10.172:5000` 端点实测：`max_tokens=200` 时约 **2/3 请求返回空 content**
  （`finish_reason=stop`、`completion_tokens` 恰好打满额度——`auto` 路由的后端模型
  会先消耗隐藏推理，额度小则正文为空），且成功响应也可能耗时近 30s（超过游戏 15s 超时）。
  空响应/超时/异常在四款游戏统一兜底为"保持沉默"，于是 AI 基本全场不说话。
- **speech-generator 三项加固**：`maxTokens 200→800`（给隐藏推理留余量，实测 8/8 有效）；
  空响应/接口错误原地重试一次（这类失败返回快、重试性价比高）；超时不重试（预算已耗尽）。
  另加 `cleanupSpeech()` 清理模型偶发的元前缀（"可以这样回应："）与整体包裹引号。
- **四款游戏 LLM 失败兜底由"沉默"改回"模板发言"**：此前为避免模板发言前后矛盾而选择沉默，
  但配合不稳定端点直接演变成全场哑巴。现在 LLM 失败率已大幅下降，模板只作最后防线，
  宁可偶尔平淡也不能让 AI 集体失声。`timeoutMs` 统一 15s→30s。
- **根治谁是小偷/剧本杀的连续平票死循环**：全 AI 对局实测约 **1.7% 陷入 2:2 平票死循环**
  （票型长期对称、嫌疑度同步累积反而固化目标，80 轮都不收敛，`runToEnd` 500 步上限被击穿，
  表现为偶发测试失败）。两个引擎补上与谁是卧底一致的 `consecutiveTies` 兜底：
  连续第 3 次平票按累计嫌疑度强制出局/指认（神偷逃脱在强制结算时同样生效），
  狼人杀无需此兜底（平票后进入夜晚，狼人必杀人，对局必然推进）。

### 技术细节
- `apps/ai-worker/src/game/speech-generator.ts`：`attemptLlmSpeech()` 单次尝试（返回
  `timedOut` 标志决定是否重试）+ `generateLlmSpeech()` 编排两次尝试 + `cleanupSpeech()`
- `apps/ai-worker/src/game/{werewolf-game,mystery-game,thief-game,undercover-game}.ts`：
  LLM 失败回退模板发言（`generateDaySpeech` / `generateMysterySpeech` /
  `generateUndercoverDescription` / `generateInvestigationSpeech`）
- `apps/ai-worker/src/game/who-is-the-thief-engine.ts`：`resolveThiefTiebreak()` +
  `resolveThiefVote()` 平票计数；`mystery-engine.ts`：`resolveMysteryTiebreak()` +
  `resolveMysteryVote()` 平票计数（强制指认走正常结算流程：正确→好人胜，错误→淘汰续轮）
- 状态字段：`ThiefGameState` / `MysteryGameState` 新增可选 `consecutiveTies`
  （旧存档缺省 undefined，`?? 0` 兜底，向后兼容）
- 回归测试：`games.test.ts` 新增小偷/剧本杀"连续 3 轮平票强制结算"用例；
  "provider 失败保持沉默"断言改为"回退模板发言"

### 验证
- 真实端点：新参数（mt=800 + 30s 超时 + 空响应重试）下 **8/8 有效发言**，0 空响应 0 超时
- 收敛性：修复后 **2000 局小偷 + 500 局剧本杀全 AI 对局 0 死循环**（修复前 300 局小偷有 5 局）
- `pnpm typecheck`：7 包零错误
- `pnpm test`：全仓 231 测试全绿（ai-core 78 + queue 22 + ai-worker 100 + api 31），
  连续两轮全仓运行稳定（修复前 3 轮挂 2 轮）
- `pnpm lint`：0 errors，仅保留既有 `console` warnings

## 2026-09-11：WP21 剧本杀凶手独白（动机/策划/作案/善后/遗言）

### 关键事件
- **凶手独白功能落地**：剧本杀进入真相揭晓阶段后，自动调用 LLM 生成凶手独白，包含五个结构化段落：
  - 【动机】杀人动机
  - 【策划】如何精心策划
  - 【作案】作案经过
  - 【善后】事后如何处理
  - 【遗言】对其他人说的话
- **结构化 LLM 提示词**：使用【标签】标记要求 LLM 输出固定格式，`parseMonologueText()` 按标签提取各段，失败时回退默认独白
- **情绪检测**：`murdererEmotionByPersonality()` 通过中文关键词匹配（悔过/不后悔/平静/怨恨/绝望）判定凶手情绪，前端显示对应情绪标签
- **前端展示**：`MysteryView` 在终局 WinnerBanner 下方新增凶手独白卡片，五个段落分区块展示，情绪标签配色区分

### 技术细节
- 后端：`apps/ai-worker/src/game/mystery-game.ts`（`generateMonologue()` 调用 + `parseMonologueText()` + `murdererEmotionByPersonality()`）
- 后端：`apps/ai-worker/src/game/mystery-engine.ts`（`getPlayerView()` 暴露 `monologue` 字段）
- 前端：`apps/web/src/components/MysteryView.tsx`（`MysteryMonologue` 接口 + `EMOTION_LABELS` 映射 + 独白 UI）
- 样式：`apps/web/src/styles/app.css`（`.monologue-reveal` 系列样式）

### 验证
- `pnpm typecheck`：7 包零错误
- `pnpm test`：全仓测试通过
- `pnpm lint`：0 errors，仅保留既有 `console` warnings

## 2026-09-11：WP22 剧本杀冲突演出系统（扭打 + 冲突 BGM + 语音发言）

### 关键事件
- **任务冲突可视化**：剧本杀讨论/指控阶段新增冲突检测，被指控方激烈反击时触发冲突事件
  - 冲突强度模型：基础强度（指控数/辩解数/情绪词）+ 性格加成（暴躁/强势 +15，敏感/胆小 -10），最终 clamp 到 5~95
  - 五级动作梯度：`fight`（扭打，≥75）→ `grab`（揪扯衣领，≥55）→ `shove`（推搡，≥35）→ `shout`（怒吼）/`threaten`（威胁）
  - 每个动作有中文描述模板池（如"一拳挥向…被旁人及时拉开"），事件写入 `events`（`type: 'conflict'`）并广播
- **冲突等级条**：前端实时显示 0~100 冲突警戒条，≥40 橙色 elevated、≥70 红色 critical（整条 UI 震动 + 游戏视图整体轻震）
- **冲突专属 BGM**：`useAdaptiveGameBgm` 新增 `conflictLevel` 输入，剧本杀讨论/指控阶段冲突 ≥50 时切换"冲突爆发"配置（tempo 112、锯齿波 drone、方波 pulse、accentEvery 2），冲突回落后自动切回原阶段配置
- **语音消息（TTS）**：发言记录每条新增播放按钮，使用浏览器 Web Speech API（`speechSynthesis`，zh-CN）朗读发言内容，播放中按钮高亮、再点停止、组件卸载自动停止

### 技术细节
- 后端：`apps/ai-worker/src/game/mystery-types.ts`（`ConflictEvent` 接口、`MysteryGameEvent` 增加 `'conflict'`、`MysteryGameState` 增加 `conflictLevel`/`conflictEvents`）
- 后端：`apps/ai-worker/src/game/mystery-engine.ts`（`EMOTION_BOOST` 情绪词权重表、`contributionOfEntry()`、`detectAndGenerateConflict()`，`addDiscussion()` 内触发；AI 发言同走 `addDiscussion` 故人类与 AI 冲突规则一致）
- 前端：`apps/web/src/components/MysteryView.tsx`（冲突等级条、`conflict-critical` 视图震动、`speakText()`/`stopSpeaking()` TTS、发言条目 `tts-btn`）
- 前端：`apps/web/src/hooks/useAdaptiveGameBgm.ts`（`GamePhaseInput.conflictLevel`、`phaseKey` 增加 `:conflict` 标记、`createProfile` 冲突分支）
- 前端：`apps/web/src/pages/GameRoom.tsx`（向 BGM hook 传 `conflictLevel`）
- 样式：`apps/web/src/styles/app.css`（`.conflict-bar` 系列、`@keyframes conflictShake/gameViewShake/conflictFlashIn`、`.tts-btn`）

### 验证
- `pnpm typecheck`：7 包零错误（修复了 `SpeechSynthesisUtterance` 事件 handler 不接受 undefined 的类型问题）
- `pnpm test`：全仓测试通过；新增 2 个冲突检测测试（反击触发冲突 / 无指控铺垫不触发），遵循"结构断言而非具体值"约定
- `pnpm lint`：0 errors，仅保留既有 `console` warnings

## 经验教训
1. Windows 环境下工作区路径处理需要特别小心，`\\?\` 前缀会导致 CMD 和部分 Node 工具异常
2. 后台进程管理在受限沙箱中不可靠，优先让用户本地终端常驻服务
3. Playwright 浏览器二进制下载和自动化在当前机器环境受限，需提前验证运行时
4. 设计 Token 和 UI 素材应在原型阶段早期提炼，避免后期重构
5. 三道门流程有效控制了产品边界，避免原型和正式工程混淆
6. **不要让编译产物成为唯一的真相来源。** 本项目崩坏的直接原因就是源码丢失而 `dist/*.d.ts` 还在，
   于是"新设计"以二进制形式存活、与 src 分叉。恢复期必须**先读 dist 再删 dist**。
7. **静默降级是这一类系统最贵的 bug。** 缺 Redis 退回内存队列、缺 `JWT_SECRET` 当匿名放行、
   模型名不认识就 warn 一下跑 mock、模型出错返回一段伪装文本 —— 四个都在本次发生，
   共同点是"看起来在工作、测试也全绿"。原则：宁可不启动，不要假装能跑。
8. **验证脚本要跑真实拓扑。** 三个 `verify:*` 脚本贡献了本次绝大多数发现，
   而 189 个单测在同样这些地方全部是绿的。跨进程、真 DB、真端点是三类不同的盲区。
9. **测试替身必须忠于契约。** 假实现用 `"room-1"` 当 id，就会让 `z.string().uuid()` 校验分支
   永远走不到，真上线时才炸。同理，过宽的大 catch 会把"广播失败"报成"检测失败"，
   让一个已经正确落库的功能看起来完全没工作。
10. **`--no-bail` 值得为 CI 之外也开着。** 原先遇首个错误即中止，一个包挂掉后面全不跑，
    错误全貌被系统性掩盖，排查时反复"修一个、再跑出下一个"。
11. **同一条消息里对同一文件做多次编辑会发生写竞争，先写的 edit 可能被后写的覆盖丢失。**
    WP19 中狼刀日志和 `!moved` 广播两处修改因此静默丢失，靠测试失败和逐文件 grep 复核才发现。
    教训：同一文件的多个 SearchReplace 必须串行，且改完用 Grep/Read 复核落盘内容。
12. **"等待人类"和"人类能否行动"必须严格一致。** 狼人杀卡死二本质是 `pendingHumans()` 与
    `step()` 对人类待开枪猎人的判定不一致：一个说他不用行动、一个说在等他行动，推进循环便永久停摆。
13. **端点返回空 content ≠ 网络问题，先看 token 预算。** 自建 `auto` 路由的后端模型会先消耗
    隐藏推理再出正文，`max_tokens` 偏小时高概率整段为空且 `finish_reason=stop`。判据：
    `completion_tokens` 恰好打满额度 + content 为空。修复是给足额度（200→800），不是无脑重试。
14. **"失败就沉默"式的兜底会把可用性 bug 放大成体验灾难。** 单看每次 LLM 失败兜底为沉默
    都合理（避免模板发言前后矛盾），但叠加 2/3 空响应率的端点，结果是全场哑巴。
15. **随机性测试必须断言结构而非具体值。** 剧本杀阶段序列、冲突动作、反转触发都依赖
    `Math.random()`，硬编码具体值会让测试偶发失败。约定：验证"序列以 introduction 开头、长度 > 4"
    而非完整序列；验证"冲突事件有 id 且有 action"而非具体强度数值。

## 2026-09-11：WP23 剧本杀深度悬疑化（帮凶 + 反转再反转 + 彩蛋角色中途入场）

### 关键事件
- **帮凶系统**：凶手可能有一名隐藏帮凶（≥5 人局 45% 概率触发，与黑警互斥）
  - 帮凶知道凶手身份，目标是指引讨论方向、掩护真凶、把怀疑引向无辜者
  - 帮凶被投出时触发身份反转事件（`PlotTwist { kind: 'identity' }`），但游戏**不会结束**
    ——必须同时投出凶手和帮凶，侦探才算胜利
  - 帮凶 AI 有独立发言策略：讨论阶段引导火力、放大伪证、制造疑点；指控阶段高确信度指控无辜者
- **剧情反转系统**：分轮次触发，颠覆此前所有推理共识
  - `timeline`（时间线推翻，第 2 轮 80%）：翻转死亡时间，重置所有不在场证明，嫌疑度随机化
  - `fabricated_clue`（伪证揭穿，第 2 轮 70%）：一条"被植入"的伪证线索被当众揭穿
  - `motive`（动机反转，第 3 轮 60%）：揭露受害者秘密信件，颠覆此前动机推断
- **彩蛋角色中途入场**：NPC 玩家（`npc-*` 前缀）在第 2~3 轮自动 push 进对局
  - 自带"入场线索"加入线索池，搜证即可发现
  - 标记为 `isLatecomer: true`，前端显示"中途入场"标签
  - `isAi()` 自动识别 npc-* 前缀，无需房间注册即自动托管发言/投票
- **证据链闭环**：关键线索分为 4 环（`means` 凶器 / `opportunity` 时机 / `motive` 动机 / `trace` 痕迹）
  - 前端实时显示 4 点进度条，X/4 环已闭合
  - 必须找到全部 4 环才能锁定凶手，缺一不可——纯靠猜/靠打情绪票都指认不了
- **结算逻辑重写**：
  - 指认凶手后，根据已闭合证据链环数生成 verdict（1-4 环，侦探方成就感完全不同）
  - 指认帮凶但不指认凶手 → 仅触发身份反转，对局继续
  - 指认了被嫁祸的玩家 → 伪证被揭穿，露出"framed"标记

### 技术细节
- 类型文件：`apps/ai-worker/src/game/mystery-types.ts`
  - `CharacterCard.isAccomplice?`、`ClueCard.chainStep/isFabricated/isFabricationExposed/fabricatedTo?`
  - `MysteryPlayerState.isLatecomer?/joinedRound?`
  - 新增 `PlotTwist` 接口（id, round, kind, title, content, revealedClueId?, timestamp）
  - 新增 `LatecomerProfile` 接口（character, arrivalClue）
  - `MysteryGameState` 新增 `accompliceId?/latecomerPool/twists/timelineDisproved?`
  - `MysteryGameEvent.type` 新增 `'twist' | 'latecomer'`
- 后端引擎：`apps/ai-worker/src/game/mystery-engine.ts`
  - `assignMysteryRoles()` 重写：返回 `{ characters, murdererId, policeId, accompliceId?, latecomerChars }`
  - `initMysteryState()` 重写：证据链标签分配 + 伪证注入 + 彩蛋池构建
  - 新增 `maybeTriggerTwist(state)`：三种反转类型按轮次条件触发
  - 新增 `addLatecomer(state)`：pop 彩蛋池 → push 玩家 → 添加入场线索
  - `nextMysteryRound()` 重写：每轮先触发反转、再按概率触发彩蛋入场
  - `resolveMysteryVote()` 重写：帮凶 reveal + framed 伪证揭穿 + chainVerdict
  - `generateMysterySpeech()` 重写：帮凶有独立发言块（讨论/指控两阶段）
  - `decideMysteryVote()` 重写：帮凶视为 `isEvil`（保护凶手、避开真凶）
  - `clueImplicationScore()` 增强：已暴露伪证返回 0
  - `getPlayerView()` 增强：暴露 twists/isLatecomer/joinedRound/isAccomplice/accompliceId（终局）
- 游戏引擎：`apps/ai-worker/src/game/mystery-game.ts`
  - `isAi()` 重写：`npc-*` 前缀 → true（自动托管）
  - `getResults()` 重写：帮凶 win 条件 = 凶手胜且帮凶存活
  - `generateEpilogues()` 增强：共犯落网/完美共谋/连环反转/迷雾终局 多结局变体
  - `speakFor()` LLM 提示词：帮凶角色专用提示词（暗中引导、不暴露身份）
- 前端：`apps/web/src/components/MysteryView.tsx`
  - `MysteryClue` 接口新增 `chainStep/isFabricated/isFabricationExposed`
  - `MysteryViewState` 新增 `twists/timelineDisproved/accompliceId`
  - 新增剧情反转横幅（`twist-banner` + `twist-flash twist-{kind}`，4 种反转各有配色）
  - 新增证据链进度条（4 点圆点 + 连接线 + X/4 环闭合提示）
- 样式：`apps/web/src/styles/app.css`
  - `.twist-banner/.twist-flash` + `@keyframes twistFlashIn/twistSweep`
  - `.evidence-chain/.chain-dot` + `.chain-dot.found` 高亮动画

### 验证
- `pnpm typecheck`：7 包零错误
- `pnpm test`：全仓测试通过
- `pnpm lint`：0 errors，仅保留既有 `console` warnings
    兜底策略必须按"最坏情况叠加"评估，而不是单次失败视角。
15. **多轮投票游戏必须保证收敛性。** 平票/无人出局若无强制结算机制，AI 票型对称时对局
    永不结束（实测 1.7%）。谁是卧底早有 `consecutiveTies` 兜底而小偷/剧本杀漏配——
    同类规则在多引擎间复制时要做一次清单核对。偶发的 `runToEnd` 步数超限不是测试问题，
    是真实 livelock 的信号。

## 2026-09-11：WP24 狼人杀 3D 模式（纯 3D 全场景）

### 关键事件
- **3D 模式引入**：为狼人杀游戏添加纯 3D 全场景视图，玩家可在 3D 村庄中体验完整对局
- **技术栈**：Three.js + @react-three/fiber (React 渲染器) + @react-three/drei (辅助工具) + @react-three/postprocessing (Bloom/Vignette 后处理)
- **场景构成**：圆形座位布局（按 seatNumber 环形排列）、中央圆桌、村庄环境（树木、篝火、月亮、星空）、昼夜氛围切换
- **角色差异化**：狼人身红色、村民灰色、预言家紫色、女巫绿色、猎人琥珀色；当前行动者头顶金色圆锥指示器；死亡角色倒地 + 红色标记
- **交互方式**：点击 3D 角色选中目标 → 底部面板确认行动（狼刀/查验/女巫/投票）；白天发言面板；支持 OrbitControls 旋转视角
- **切换方式**：右上角浮动 3D/2D 切换按钮，即时切换两种视图

### 技术细节
- 依赖：`three@^0.169.0`, `@react-three/fiber@^8.17.0`, `@react-three/drei@^9.114.0`, `@react-three/postprocessing@^2.16.0`, `@types/three@^0.169.0`
- 组件文件：
  - `apps/web/src/components/werewolf3d/PlayerAvatar.tsx` — 3D 角色模型（胶囊体 + 球体头部 + 名牌 Html overlay）
  - `apps/web/src/components/werewolf3d/GameTable.tsx` — 圆桌 + 动态灯光
  - `apps/web/src/components/werewolf3d/Environment3D.tsx` — 村庄场景（树木、篝火、月亮、星空、雾）
  - `apps/web/src/components/werewolf3d/WerewolfScene.tsx` — Canvas 包装器（相机、OrbitControls、后处理）
  - `apps/web/src/components/werewolf3d/Werewolf3DView.tsx` — 主组件（HUD + 交互面板 + 侧边栏）
- 集成点：`apps/web/src/pages/GameRoom.tsx` — 新增 `is3DMode` 状态 + 浮动切换按钮
- 样式：`apps/web/src/styles/app.css` — 新增 `.werewolf3d*` 系列 CSS 类（约 370 行）
- 座位半径自适应：≤4 人 r=2, ≤6 人 r=2.5, ≤8 人 r=3, >8 人 r=3.5
- 响应式：窄屏（≤768px）侧边栏移至底部，时间线隐藏

### 验证
- `pnpm lint`：0 errors
- `pnpm test`：31 tests 全部通过
- `pnpm typecheck`：Three.js JSX 固有元素类型错误（待 `pnpm install` 后自动消除）

### 经验教训
- `@react-three/fiber` 通过模块扩展 `JSX.IntrinsicElements` 添加 Three.js 元素类型，未安装时所有 `<mesh>`/`<group>` 等标签报 TS 错误
- lucide-react 图标名称需精确匹配，`FlaskCross` 不存在，正确名称为 `FlaskConical`
- 共享组件（PhaseBadge/RoleCard/WinnerBanner）的 props 接口可能与新需求不匹配，需适配而非强行传参

## 下一步
- 运行 `pnpm install` 安装 Three.js 依赖，消除剩余 TS 类型错误
- 3D 模式性能优化：降低移动设备上的后处理开销
- 添加更多 3D 动画：投票指向手势、猎人开枪火化、身份揭示光效
- 实现 `mvp-spec §3.4` 的点名下一位发言者（连同后端支持一起加，不留悬空契约字段）
- 安全收尾：轮换模型 Key、MySQL 换最小权限账号、加强 `JWT_SECRET`
- 推送到 GitHub 跑一次真实 CI，验证 MySQL/Redis service containers 在云端可用
- 在目标裸机按 `docs/deployment.md` 走一遍首次部署，验证 `release.sh` 端到端
