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

## 下一步
- 实现 `mvp-spec §3.4` 的点名下一位发言者（连同后端支持一起加，不留悬空契约字段）
- 安全收尾：轮换模型 Key、MySQL 换最小权限账号、加强 `JWT_SECRET`
- 推送到 GitHub 跑一次真实 CI，验证 MySQL/Redis service containers 在云端可用
- 在目标裸机按 `docs/deployment.md` 走一遍首次部署，验证 `release.sh` 端到端
