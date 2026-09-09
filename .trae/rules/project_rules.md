# 项目规则

## 固定动作（每次任务完成后必须执行）

### 1. 维护项目文档
每次功能开发或 bug 修复完成后，必须同步更新以下文档：
- `docs/project-history.md` — 新增一个带日期的小节，记录关键事件、技术细节、验证结果
- `docs/development.md` — 如有 API 端点、命令、架构变化则更新对应章节

### 2. 同步 Obsidian 知识库
每次任务完成后，必须同步更新 Obsidian 中的项目归档：
- Vault 路径：`20-Work/天马不行空-项目归档.md`
- 更新内容：核心功能、架构设计、数据库 Schema、API 端点、测试覆盖、经验教训、下一步计划
- 使用 MCP Obsidian 工具（`vault_write` 或 `vault_patch`）进行更新

### 3. 验证三件套
每次代码变更后，提交前必须运行：
- `pnpm typecheck` — 7 个包零错误
- `pnpm test` — 全部测试通过
- `pnpm lint` — 0 errors（warnings 可接受）

## 技术约定

### PowerShell 命令
- 使用 `;` 分隔语句，不要用 `&&`（PowerShell 不支持）
- 避免 `ls -la` 等 Unix 命令，用 PowerShell 原生命令

### 测试编写
- 游戏引擎测试中，涉及随机性（AI 投票结果不确定）的断言应验证**结构**而非**具体值**
- 例如：验证阶段序列以 `introduction` 开头、长度 > 4，而非硬编码完整序列

### Git 提交
- 提交信息格式：`<type>: <描述>`（feat/fix/test/docs/refactor）
- 中文描述，简洁明了
- 用户明确要求「提交/提交吧」时：必须 **commit + push 一次性完成**（推送是默认规定动作，不要只提交不推送，也不要询问是否推送）
- 用户未明确要求时：不自动提交
