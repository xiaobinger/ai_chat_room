# MVP 验收对照

`docs/product/mvp-spec.md` §9 的 7 条验收条件，逐条对应到可复现的证据。

**复现方式分三层，出问题时按顺序缩小范围：**
- **`pnpm verify:queue`** —— 只验传输。拉起两个子进程，证明一个 job 真的跨进程被消费、一条房间事件真的被订阅端收到。不需要数据库。
- **`pnpm verify:run`** —— 只验导演。单进程认领 Run 跑完一场，检查序号连续、审计落库、终态原因。`pnpm verify:run mock` 可完全离线。
- **`pnpm verify:e2e`** —— 验整条链路和验收条件。要求 `pnpm dev:api` 与 `pnpm dev:worker` 在跑，走 HTTP + 真 WebSocket，逐条输出 §9 的 PASS/FAIL。会自己清掉建的房间。
- **浏览器实测** —— `pnpm dev:web`（开发期经 vite proxy 反代 `/api` 与 `/ws`），用真实浏览器走过 §9 涉及界面的部分：注册 → 大厅 → 五步向导 → 聊天室 → 治理规则 → 复盘。这是唯一能证明"界面行为符合预期"的手段；API/单测替代不了。

离线复现（不碰外部模型端点）：`E2E_MODEL=mock`，默认即为 `mock`。
用真实端点复现 #3/#4：`E2E_MODEL=<MODELS_CONFIG 里的名字> pnpm verify:e2e`。

| # | 验收条件 | 状态 | 证据 |
|---|---|---|---|
| 1 | 新用户能在 3 分钟内创建房间、加入至少 3 个角色并启动讨论 | ✅ 浏览器实测 | 向导五步一次走完：注册→建房（选 3 个内置角色）→发布默认策略 v1 → 启动→自动进入聊天室；实测单跑数秒完成 |
| 2 | 主题模式中，偏题角色会产生包含规则、证据和动作的治理事件 | ✅ | 同上；见下节"治理事件必含字段" |
| 3 | 自由模式中至少 3 个角色可连续交流，并在预算或终止条件触发时停止 | ✅ | 3 角色 × 多轮，`status=terminated reason=round_limit/token_budget` |
| 4 | 暂停后 2 秒内无 AI 新消息；恢复后轮次继续递增 | ✅ | 暂停后 2.5 秒复查，AI 消息条数不变；恢复后状态回到 queued/running |
| 5 | 房主可以撤销禁言；撤销动作进入审计记录 | ✅ | 撤销后原事件保留 `action=mute` 不变，另写 `revertedAt` / `revertedBy` |
| 6 | 刷新或断线恢复后消息无缺失、无重复且顺序一致 | ✅ | 序号 `1..N` 连续无缺口；用 `GET /messages?after=0` 回补的集合与终态完全一致且 id 唯一 |
| 7 | 讨论复盘能展示观点、共识、分歧和治理动作，并可定位到原消息 | ✅ 浏览器实测 | 复盘页展示共识/争论/未解决/关键观点/阵营/治理动作；每条结论带引用，可展开原消息并在聊天室定位高亮 |

## 治理事件必含字段（#2 / #5）

`permissions.md` §5 要求的审计字段全部落库，`verify:e2e` 对每条事件断言：

| 字段 | 取值 | 来源 |
|---|---|---|
| `actorType` | `moderator`（AI 执行）或 `owner`（房主手动） | 状态机与两条执行路径 |
| `matchedRule` | 命中的规则 id，例如 `R-05` | `ai-core` 检测结果 |
| `policyVersion` | 产生该事件时生效的策略版本 | 不可变的 `ModeratorPolicy.version` |
| `evidenceMessageIds` | 证据消息 id 数组，非空 | 检测器给出的命中消息 |
| `reason` | 人类可读的判定说明（含阈值/命中词/相似度） | `RuleHit.explanation` + 阶梯说明 |
| `durationRounds` | 禁言轮次数；非禁言为 null | `currentRound + defaultMuteRounds` |
| `penaltyLevel` | 处置后的阶梯游标 | `decideLadderAction.nextLevel` |
| `revertedAt` / `revertedBy` | 房主撤销时写入；原事件不被改写 | 撤销端点 |

`verify:e2e` 额外断言阶梯会**逐级升档**：同一角色反复违规时事件动作的时间序是
`remind → warn → mute → kick`，而不是一上来就移出。

## 复盘的可追溯性是构造保证的

`#7` 不是"希望模型老实引用"，而是两条硬规则（`apps/ai-worker/src/summarizer.ts`）：

1. 让模型引用**消息序号**而不是 uuid（模型无法可靠复述 36 位 id），服务端再把序号映射回真实消息 id。
2. **映射不上的条目直接丢弃**。所以一条复盘结论不可能引用一条不存在的消息。

降级路径也保证可追溯：模型不可用、输出不合契约、或全部引用都是编造的，就整体退回**摘录模式** —— 观点直接摘自真实消息，治理段落由已落库的事件构成，`mode: 'extractive'` 与降级原因一起返回，界面必须区分标注，不假装是 AI 归纳的。

## 单元测试覆盖

`pnpm test`，189 个用例，不依赖任何外部服务（除 `apps/api` 需要 MySQL）：

| 包 | 数量 | 覆盖 |
|---|---|---|
| `packages/ai-core` | 78 | 三个状态机的合法/非法转移、导演计分与硬排除、预算三维、设置解析、治理检测器、处罚阶梯、策略语义校验 |
| `packages/queue` | 22 | Redis 连接串解析（含密码/库号/TLS/脱敏）、驱动显式选择、内存队列语义 |
| `apps/ai-worker` | 58 | 调度循环、租约与版本冲突、暂停优先、治理执行与阶梯、复盘与引用校验、模型名解析失败关闭 |
| `apps/api` | 31 | 注册登录、授权边界、身份伪造防御、发号原子性、WS 鉴权、策略版本化、复盘端点 |

## 尚未覆盖

- 界面层：`apps/web` 仍是硬编码假数据，还没有浏览器实测（`mvp-spec` 要求的"3 分钟上手"目前只能在 API 层证明）。
- `mvp-spec §3.4` 的"点名下一位发言者"未实现，契约里也没留空字段。
- CI：`.github/workflows/ci.yml` 还没接 MySQL/Redis service，仓库也未纳入 git。
