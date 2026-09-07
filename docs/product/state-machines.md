# 运行状态机

## 1. DiscussionRun 状态机
### 1.1 状态
- `draft`：房间配置尚未启动，可编辑主题、角色和规则。
- `queued`：启动请求已接受，等待 Worker 获取任务。
- `running`：允许调度并产生 AI 消息。
- `paused`：停止创建新的模型调用，保留上下文和剩余预算。
- `completed`：达到完成条件或房主选择正常结束。
- `terminated`：因预算、安全、循环、管理员或房主强制终止。
- `failed`：系统错误导致无法继续，允许在条件满足时恢复或复制 Run。

### 1.2 合法转移
| 当前状态 | 事件 | 下一状态 | 约束 |
|---|---|---|---|
| draft | START | queued | 至少 1 个可发言 AI；主题模式必须有主题 |
| queued | WORKER_CLAIMED | running | 只能有一个有效 Worker Lease |
| queued | CANCEL | terminated | 记录 `user_cancelled` |
| queued | START_FAILED | failed | 保存可重试错误码 |
| running | PAUSE | paused | 不再创建新模型调用 |
| running | COMPLETE | completed | 达到完成条件或房主正常结束 |
| running | TERMINATE | terminated | 保存终止原因与触发方 |
| running | SYSTEM_FAILURE | failed | 不自动丢弃已完成消息 |
| paused | RESUME | queued | 重新入队，轮次连续递增 |
| paused | COMPLETE | completed | 房主可在暂停态正常结束 |
| paused | TERMINATE | terminated | 房主或安全规则终止 |
| failed | RETRY | queued | 错误可重试且预算未耗尽 |
| failed | TERMINATE | terminated | 放弃恢复 |

`completed` 与 `terminated` 为终态，不允许原地恢复；继续讨论必须创建新 Run 并引用旧 Run 摘要。

### 1.3 终止原因
`round_limit`、`token_budget`、`cost_budget`、`time_limit`、`repetition_loop`、`safety_violation`、`no_available_agents`、`owner_terminated`、`user_cancelled`。

### 1.4 并发规则
- 每个 Run 同一时刻最多一个主动调度 Lease。
- `PAUSE`、`TERMINATE` 和预算耗尽优先于下一轮调度。
- 状态更新使用版本号或条件更新；版本冲突时重新读取，不覆盖新状态。

## 2. RoomAgent 状态机
### 2.1 状态
- `idle`：可被调度。
- `thinking`：模型调用已开始，尚未输出正式内容。
- `speaking`：正在流式输出。
- `muted`：在指定轮次或时间前不可被调度。
- `removed`：已从当前房间移出，为终态。
- `error`：最近一次模型调用失败，可按策略恢复。

### 2.2 合法转移
| 当前状态 | 事件 | 下一状态 | 约束 |
|---|---|---|---|
| idle | SELECT | thinking | Run 必须为 running 且角色未被禁言 |
| thinking | FIRST_TOKEN | speaking | 创建流式消息占位 |
| thinking | CALL_FAILED | error | 记录错误类别与重试次数 |
| thinking | MUTE | muted | 取消正在运行的调用 |
| speaking | COMPLETE_MESSAGE | idle | 消息落库后才转换 |
| speaking | OUTPUT_FAILED | error | 保留已输出片段并标记失败 |
| speaking | MUTE | muted | 立即停止后续输出并记录治理事件 |
| idle | MUTE | muted | 保存解禁条件 |
| error | RETRY | thinking | 未超过重试上限 |
| error | RESET | idle | 由房主或系统恢复 |
| muted | UNMUTE | idle | 到期或房主撤销 |
| idle/muted/error | REMOVE | removed | 保存执行者和原因 |

### 2.3 非法转移处理
非法事件不得静默成功。API 返回冲突，审计日志记录当前状态、请求事件和请求者；客户端重新同步状态后再决定是否重试。

## 3. 消息状态
消息状态为 `pending → streaming → completed`，失败可进入 `failed`，人工删除进入 `deleted`。只有 `completed` 消息进入后续角色的正式上下文；流式片段用于展示但不得被其他角色提前引用。

## 4. 状态一致性信号
- 暂停后 Run 为 `paused`，不存在新建模型调用。
- 角色发言完成后消息为 `completed`，角色回到 `idle`。
- 禁言角色不出现在下一发言者候选集中。
- 终态 Run 不再增加 `round`、Token 或消息序号。
